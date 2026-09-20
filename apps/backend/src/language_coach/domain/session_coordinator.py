import asyncio
import logging
import re
import time
from collections import Counter
from collections.abc import Callable, Coroutine
from dataclasses import dataclass
from typing import Any, Protocol
from uuid import UUID

from language_coach.domain.interventions import (
    InterventionRecord,
    InterventionStore,
    normalize_fragment,
    source_is_contained,
)
from language_coach.domain.models import (
    ConversationMode,
    ParticipantId,
    SpeakerObserved,
    SpeechCompleted,
    SpeechStarted,
    TranscriptionFailure,
    TranscriptPartial,
)
from language_coach.domain.playback_gate import PlaybackGate
from language_coach.domain.speaker_mapping import SpeakerMapping, SpeakerSwapUnavailable
from language_coach.domain.transcript_store import TranscriptStore
from language_coach.protocol.models import (
    Activity,
    CancellationReason,
    DegradedCode,
    DegradedSubsystem,
    InterventionAudioFailedPayload,
    InterventionAudioReadyPayload,
    InterventionAudioRetry,
    InterventionCancelledPayload,
    InterventionCommittedPayload,
    InterventionPreviewPayload,
    PlaybackEnded,
    PlaybackInterrupted,
    PlaybackKind,
    PlaybackStarted,
    PlaybackStartRequestedPayload,
    PlaybackStopReason,
    PlaybackStopRequestedPayload,
    ServerEvent,
    ServerEventPayload,
    SessionConfig,
    SessionDegradedPayload,
    SessionEndedPayload,
    SessionEndedReason,
    SessionErrorPayload,
    SessionStatusPayload,
    SessionWarningPayload,
    SpeakerMappedPayload,
    SpeakersSwap,
)
from language_coach.providers.device_speech import DEVICE_SPEECH_CONTENT_TYPE
from language_coach.providers.interfaces import (
    AnalysisRequest,
    AnalysisUnavailable,
    InvalidPcmFrame,
    MuseStartFailed,
    SparkAnalyzer,
    SpeechRequest,
    SpeechSynthesisUnavailable,
    SpeechSynthesizer,
    Transcriber,
    TranscriptionConfig,
    TranscriptionSession,
)
from language_coach.services.audio_assets import InMemoryAudioStore
from language_coach.services.capabilities import get_capability
from language_coach.services.safe_logging import log_event

logger = logging.getLogger(__name__)
ACTIVITIES: tuple[Activity, ...] = ("listening", "analyzing", "audio_pending", "speaking")


class Clock(Protocol):
    def now_ms(self) -> int: ...

    async def sleep_ms(self, milliseconds: int) -> None: ...


class SystemClock:
    def now_ms(self) -> int:
        return int(time.monotonic() * 1000)

    async def sleep_ms(self, milliseconds: int) -> None:
        await asyncio.sleep(max(0, milliseconds) / 1000)


class SequencedEventSink(Protocol):
    async def emit(self, payload: ServerEventPayload) -> ServerEvent: ...


type AudioUrlFactory = Callable[[UUID, str], str]


@dataclass
class PlaybackWindow:
    intervention_id: str
    started_at_ms: int
    target_text: str
    ended_at_ms: int | None = None


class ConversationCoordinator:
    def __init__(
        self,
        session_id: UUID,
        config: SessionConfig,
        transcriber: Transcriber,
        analyzer: SparkAnalyzer,
        synthesizer: SpeechSynthesizer,
        audio_store: InMemoryAudioStore,
        event_sink: SequencedEventSink,
        clock: Clock,
        audio_url_factory: AudioUrlFactory | None = None,
    ) -> None:
        self.session_id = session_id
        self.config = config
        self.transcriber = transcriber
        self.analyzer = analyzer
        self.synthesizer = synthesizer
        self.audio_store = audio_store
        self.event_sink = event_sink
        self.clock = clock
        self.audio_url_factory = audio_url_factory or (
            lambda session_id, asset_id: f"https://localhost:8444/v1/sessions/{session_id}/audio/{asset_id}"
        )
        self.transcripts = TranscriptStore()
        self.interventions = InterventionStore()
        self.speaker_mapping = SpeakerMapping(ConversationMode(config.mode))
        self.playback = PlaybackGate()
        self._transcription: TranscriptionSession | None = None
        self._started = asyncio.Event()
        self._closed = asyncio.Event()
        self._stop = asyncio.Event()
        self._finish_lock = asyncio.Lock()
        self._start_error: MuseStartFailed | None = None
        self._stop_reason: SessionEndedReason = "user_end"
        self._run_active = False
        self._accepting_audio = False
        self._turn_labels: dict[str, str] = {}
        self._turn_windows: dict[str, list[PlaybackWindow]] = {}
        self._windows: list[PlaybackWindow] = []
        self._partial_tasks: dict[str, asyncio.Task[None]] = {}
        self._tasks: set[asyncio.Task[None]] = set()
        self._task_group: asyncio.TaskGroup | None = None
        self._input_audio_ms = 0
        self._started_at_ms = 0
        self._activities: Counter[Activity] = Counter({"listening": 1})
        self._degraded: set[DegradedSubsystem] = set()
        self._mapping_generation = 0

    @property
    def closed(self) -> bool:
        return self._closed.is_set()

    @property
    def stopping(self) -> bool:
        return self._stop.is_set() or self.closed

    @property
    def input_audio_ms(self) -> int:
        return self._input_audio_ms

    async def run(self) -> None:
        if self._run_active or self.closed:
            return
        self._run_active = True
        self._started_at_ms = self.clock.now_ms()
        try:
            try:
                self._transcription = await self._open_transcription()
            except MuseStartFailed as error:
                self._start_error = error
                self._started.set()
                await self._degrade("transcription", "muse_start_failed")
                return
            if self.stopping:
                self._start_error = MuseStartFailed("session ended during startup")
                return
            self._accepting_audio = True
            async with asyncio.TaskGroup() as group:
                self._task_group = group
                self._spawn(self._consume_transcription())
                self._spawn(self._playback_loop())
                self._spawn(self._lifetime_loop())
                self._started.set()
                await self._stop.wait()
                for task in tuple(self._tasks):
                    task.cancel()
        except* (RuntimeError, ValueError, TypeError, KeyError, OSError) as errors:
            log_event(logger, logging.ERROR, "session_task_failed", {
                "session_id": str(self.session_id),
                "exception_class": type(errors).__name__,
            })
            await self._degrade("transcription", "muse_connection_lost")
        finally:
            self._task_group = None
            if not self._started.is_set():
                self._start_error = MuseStartFailed("session did not start")
                self._started.set()
            await self._finish()

    async def _open_transcription(self) -> TranscriptionSession:
        codes = [self.config.learner1_native_language]
        if self.config.learner2_native_language:
            codes.append(self.config.learner2_native_language)
        codes.append(self.config.learning_language)
        bias = tuple(dict.fromkeys(get_capability(code).muse_bias_name for code in codes))
        try:
            async with asyncio.timeout(10):
                return await self.transcriber.open(TranscriptionConfig(self.session_id, bias))
        except (RuntimeError, OSError, ValueError):
            raise MuseStartFailed("Muse start failed") from None

    def _spawn(self, work: Coroutine[Any, Any, None]) -> asyncio.Task[None] | None:
        if self._task_group is None or self.stopping:
            work.close()
            return None
        task = self._task_group.create_task(work)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        return task

    async def wait_started(self) -> None:
        await self._started.wait()
        if self._start_error is not None:
            raise self._start_error

    async def wait_closed(self) -> None:
        await self._closed.wait()

    async def accept_pcm(self, frame: bytes) -> None:
        if len(frame) != 3840:
            raise InvalidPcmFrame("PCM frames must be exactly 3,840 bytes")
        if not self._accepting_audio or self._transcription is None or self.stopping:
            raise RuntimeError("session is not accepting audio")
        try:
            await self._transcription.send_pcm(frame)
        except (OSError, RuntimeError):
            await self._degrade("transcription", "muse_connection_lost")
            raise RuntimeError("transcription unavailable") from None
        self._input_audio_ms += 80

    async def handle_control(self, message: object) -> None:
        if self.stopping:
            return
        try:
            if isinstance(message, SpeakersSwap):
                await self._swap_speakers()
            elif isinstance(message, PlaybackStarted):
                await self._playback_started(str(message.intervention_id), message.manual)
            elif isinstance(message, (PlaybackEnded, PlaybackInterrupted)):
                await self._playback_ended(
                    str(message.intervention_id), isinstance(message, PlaybackInterrupted)
                )
            elif isinstance(message, InterventionAudioRetry) and self.interventions.consume_audio_retry(message.intervention_id):
                self._spawn(self._synthesize(self.interventions.get(message.intervention_id)))
        except (KeyError, SpeakerSwapUnavailable):
            await self.event_sink.emit(SessionErrorPayload(
                code="invalid_state", message="That action is not available yet.", recoverable=True,
            ))

    async def handle_connection_lost(self) -> None:
        intervention_id = self.playback.handle_connection_lost()
        self._close_playback_windows()
        self._activities["speaking"] = 0
        if intervention_id is not None:
            self.interventions.mark_interrupted(UUID(intervention_id))
            await self._request_playback_stop(intervention_id, "connection_lost")
        await self._emit_status()

    def resume_audio(self) -> None:
        self.playback.suspended = False

    async def close(self, reason: SessionEndedReason = "user_end") -> None:
        if not self._stop.is_set():
            self._stop_reason = reason
            self._accepting_audio = False
            self._stop.set()
        if not self._run_active:
            self._start_error = MuseStartFailed("session ended before startup")
            self._started.set()
            await self._finish()

    async def _consume_transcription(self) -> None:
        if self._transcription is None:
            return
        async for event in self._transcription.events():
            if self.stopping:
                return
            if isinstance(event, SpeechStarted):
                self.transcripts.start(event.turn_id, event.audio_processed_ms)
                if not self._overlaps_playback(event.turn_id, event.audio_processed_ms):
                    await self._confirm_human(event.turn_id)
            elif isinstance(event, SpeakerObserved):
                await self._on_speaker(event)
            elif isinstance(event, TranscriptPartial):
                await self._on_partial(event)
            elif isinstance(event, SpeechCompleted):
                await self._on_completed(event)
            elif isinstance(event, TranscriptionFailure):
                await self._degrade("transcription", "muse_connection_lost")
                return
        if not self.stopping:
            await self._degrade("transcription", "muse_connection_lost")

    def _overlaps_playback(self, turn_id: str, through_ms: int) -> bool:
        start = self.transcripts.get(turn_id).started_at_ms
        if start is None:
            start = through_ms
        windows = [
            window for window in self._windows
            if window.started_at_ms <= through_ms
            and (window.ended_at_ms is None or start <= window.ended_at_ms)
        ]
        if windows:
            self._turn_windows[turn_id] = windows
        return bool(self._turn_windows.get(turn_id))

    @staticmethod
    def _echo_text(value: str) -> str:
        return re.sub(r"[^\w\s]", "", normalize_fragment(value)).casefold()

    def _matches_generated_prefix(self, turn_id: str, text: str) -> bool:
        candidate = self._echo_text(text)
        return any(
            self._echo_text(window.target_text).startswith(candidate)
            for window in self._turn_windows.get(turn_id, [])
        )

    async def _confirm_human(self, turn_id: str) -> None:
        interrupted = self.playback.on_speech_started(turn_id, self.clock.now_ms(), True)
        if interrupted is not None:
            if self.playback.playing == interrupted:
                self.interventions.mark_interrupted(UUID(interrupted))
            await self._request_playback_stop(interrupted, "human_speech")

    async def _on_speaker(self, event: SpeakerObserved) -> None:
        record = self.transcripts.get(event.turn_id)
        self._turn_labels[event.turn_id] = event.label
        record.speaker_label = event.label
        if self._overlaps_playback(event.turn_id, event.audio_processed_ms):
            if self.speaker_mapping.participant_for(event.label) is not None:
                await self._confirm_human(event.turn_id)
            return
        previous = self.speaker_mapping.participant_for(event.label)
        started_at = record.started_at_ms
        participant = self.speaker_mapping.observe(
            event.label,
            started_at if started_at is not None else event.audio_processed_ms,
            False,
        )
        if participant is not None and previous is None:
            await self._emit_mapping(event.label, participant)
        self._schedule_preview(event.turn_id)

    async def _on_partial(self, event: TranscriptPartial) -> None:
        record = self.transcripts.get(event.turn_id)
        if record.final or event.revision <= record.revision:
            return
        self.transcripts.apply_partial(event.turn_id, event.revision, event.text)
        self.interventions.note_revision(event.turn_id, event.revision)
        if self._overlaps_playback(event.turn_id, event.audio_processed_ms):
            if not self._matches_generated_prefix(event.turn_id, event.text):
                await self._confirm_human(event.turn_id)
            return
        self._schedule_preview(event.turn_id)

    def _participant(self, turn_id: str) -> ParticipantId | None:
        label = self._turn_labels.get(turn_id)
        return self.speaker_mapping.participant_for(label) if label is not None else None

    def _schedule_preview(self, turn_id: str) -> None:
        record = self.transcripts.get(turn_id)
        participant = self._participant(turn_id)
        if record.final or not record.revision or participant not in {
            ParticipantId.LEARNER_1, ParticipantId.LEARNER_2,
        }:
            return
        prior = self._partial_tasks.pop(turn_id, None)
        if prior is not None:
            prior.cancel()
        task = self._spawn(self._debounced_preview(
            turn_id, record.revision, record.text, participant, self._mapping_generation,
        ))
        if task is not None:
            self._partial_tasks[turn_id] = task

    async def _debounced_preview(
        self, turn_id: str, revision: int, transcript: str,
        participant: ParticipantId, mapping_generation: int,
    ) -> None:
        await self.clock.sleep_ms(300)
        current = self.transcripts.get(turn_id)
        if current.final or current.revision != revision or mapping_generation != self._mapping_generation:
            return
        try:
            analysis = await self.analyzer.analyze(
                self._analysis_request(turn_id, transcript, participant, final=False)
            )
        except AnalysisUnavailable:
            return
        current = self.transcripts.get(turn_id)
        if self.stopping or current.final or current.revision != revision or mapping_generation != self._mapping_generation:
            return
        sources = {normalize_fragment(candidate.source_text) for candidate in analysis.interventions}
        for record in self.interventions.reconcile_previews(turn_id, sources, "preview_obsolete"):
            await self._emit_cancelled(record, "preview_obsolete")
        for candidate in analysis.interventions:
            preview = self.interventions.preview(
                turn_id, revision, candidate.source_text, candidate.target_text, transcript,
                self._native_code(participant), self.config.learning_language, participant,
            )
            if preview is not None:
                await self.event_sink.emit(InterventionPreviewPayload(
                    turn_id=preview.turn_id, intervention_id=preview.intervention_id,
                    participant_id=participant.value, revision=revision,
                    source_text=preview.source_text, source_language=preview.source_language,
                    target_text=preview.target_text, target_language=preview.target_language,
                ))

    async def _on_completed(self, event: SpeechCompleted) -> None:
        record = self.transcripts.get(event.turn_id)
        if record.final:
            return
        task = self._partial_tasks.pop(event.turn_id, None)
        if task is not None:
            task.cancel()
        self.interventions.finalize_turn(event.turn_id)
        self.transcripts.finalize(
            event.turn_id, event.speaker_label, event.text, event.audio_processed_ms,
        )
        if self._overlaps_playback(event.turn_id, event.audio_processed_ms):
            if not self._matches_generated_prefix(event.turn_id, event.text):
                await self._confirm_human(event.turn_id)
            if event.turn_id in self.playback.active_human_turns:
                self.playback.on_speech_completed(event.turn_id, self.clock.now_ms())
            return
        self.playback.on_speech_completed(event.turn_id, self.clock.now_ms())
        participant = self._participant(event.turn_id)
        if participant in {ParticipantId.LEARNER_1, ParticipantId.LEARNER_2}:
            self._spawn(self._analyze_final(event.turn_id, event.text, participant))

    async def _analyze_final(self, turn_id: str, text: str, participant: ParticipantId) -> None:
        await self._activity("analyzing", 1)
        try:
            analysis = await self.analyzer.analyze(
                self._analysis_request(turn_id, text, participant, final=True)
            )
            if any(not source_is_contained(item.source_text, text) for item in analysis.interventions):
                raise AnalysisUnavailable("analysis source is not contained")
        except AnalysisUnavailable:
            await self._degrade("translation", "analysis_unavailable")
            for record in self.interventions.cancel(turn_id, "final_empty"):
                await self._emit_cancelled(record, "final_empty")
            return
        finally:
            await self._activity("analyzing", -1)
        if self.stopping:
            return
        self._degraded.discard("translation")
        sources = {normalize_fragment(item.source_text) for item in analysis.interventions}
        reason: CancellationReason = "final_replaced" if sources else "final_empty"
        for record in self.interventions.reconcile_previews(turn_id, sources, reason):
            await self._emit_cancelled(record, reason)
        committed_sources: set[str] = set()
        for candidate in analysis.interventions:
            source = normalize_fragment(candidate.source_text)
            if source in committed_sources:
                continue
            committed_sources.add(source)
            record = self.interventions.commit(turn_id, candidate, participant)
            record.source_language = self._native_code(participant)
            record.target_language = self.config.learning_language
            await self.event_sink.emit(InterventionCommittedPayload(
                turn_id=record.turn_id, intervention_id=record.intervention_id,
                participant_id=participant.value,
                source_text=record.source_text, source_language=record.source_language,
                target_text=record.target_text, target_language=record.target_language,
            ))
            await self._synthesize(record)

    def _analysis_request(
        self, turn_id: str, transcript: str, participant: ParticipantId, final: bool,
    ) -> AnalysisRequest:
        return AnalysisRequest(
            participant=participant.value,
            native_language=get_capability(self._native_code(participant)).display_name,
            learning_language=get_capability(self.config.learning_language).display_name,
            transcript=transcript,
            context=tuple(item.text for item in self.transcripts.context_before(turn_id, 2)),
            final=final,
        )

    async def _synthesize(self, record: InterventionRecord) -> None:
        await self._activity("audio_pending", 1)
        try:
            audio = await self.synthesizer.synthesize(
                SpeechRequest(record.target_text, self.config.learning_language)
            )
            if self.stopping:
                return
            self._degraded.discard("speech")
            if audio.content_type == DEVICE_SPEECH_CONTENT_TYPE:
                asset_id = f"device-speech:{record.intervention_id}"
                playback_kind: PlaybackKind = "device_speech"
                audio_url = None
            else:
                asset_id = self.audio_store.put(self.session_id, audio, record.intervention_id)
                playback_kind = "audio_url"
                audio_url = self.audio_url_factory(self.session_id, asset_id)
            self.interventions.mark_audio_ready(record.intervention_id, asset_id)
            await self.event_sink.emit(InterventionAudioReadyPayload(
                turn_id=record.turn_id, intervention_id=record.intervention_id,
                playback_kind=playback_kind, audio_url=audio_url,
            ))
            self.playback.on_audio_ready(str(record.intervention_id))
        except SpeechSynthesisUnavailable:
            self.interventions.mark_audio_failed(
                record.intervention_id, retry_available=record.audio_retry_remaining > 0,
            )
            await self.event_sink.emit(InterventionAudioFailedPayload(
                turn_id=record.turn_id, intervention_id=record.intervention_id,
                retry_available=record.audio_retry_remaining > 0,
            ))
            await self._degrade("speech", "speech_unavailable")
        finally:
            await self._activity("audio_pending", -1)

    async def _playback_loop(self) -> None:
        while not self.stopping:
            await self.clock.sleep_ms(50)
            intervention_id = self.playback.reserve_eligible(self.clock.now_ms())
            if intervention_id is not None:
                generation = self.playback.reservation_generation
                await self.event_sink.emit(PlaybackStartRequestedPayload(
                    intervention_id=UUID(intervention_id),
                ))
                self._spawn(self._start_watchdog(intervention_id, generation))

    async def _start_watchdog(self, intervention_id: str, generation: int) -> None:
        await self.clock.sleep_ms(2000)
        self.playback.on_start_timeout(intervention_id, generation)

    async def _lifetime_loop(self) -> None:
        await self.clock.sleep_ms(max(0, self._started_at_ms + 49 * 60_000 - self.clock.now_ms()))
        remaining_ms = self._started_at_ms + 50 * 60_000 - self.clock.now_ms()
        await self.event_sink.emit(SessionWarningPayload(seconds_remaining=max(0, remaining_ms // 1000)))
        await self.clock.sleep_ms(max(0, remaining_ms))
        await self.close("lifetime")

    async def _playback_started(self, intervention_id: str, manual: bool) -> None:
        record = self.interventions.get(UUID(intervention_id))
        if record.asset_id is None:
            raise KeyError(intervention_id)
        if self.playback.playing == intervention_id:
            return
        accepted = self.playback.on_playback_started(intervention_id, self.clock.now_ms(), manual)
        self._windows.append(PlaybackWindow(intervention_id, self._input_audio_ms, record.target_text))
        self._activities["speaking"] = 1
        await self._emit_status()
        if not accepted:
            await self._request_playback_stop(intervention_id, "human_speech")

    async def _playback_ended(self, intervention_id: str, interrupted: bool) -> None:
        ended = (
            self.playback.on_playback_interrupted(intervention_id, self.clock.now_ms())
            if interrupted else self.playback.on_playback_ended(intervention_id, self.clock.now_ms())
        )
        if ended and interrupted:
            self.interventions.mark_interrupted(UUID(intervention_id))
        self._close_playback_windows(intervention_id)
        self._activities["speaking"] = int(any(window.ended_at_ms is None for window in self._windows))
        await self._emit_status()

    def _close_playback_windows(self, intervention_id: str | None = None) -> None:
        for window in self._windows:
            if window.ended_at_ms is None and (
                intervention_id is None or window.intervention_id == intervention_id
            ):
                window.ended_at_ms = self._input_audio_ms

    async def _request_playback_stop(self, intervention_id: str, reason: PlaybackStopReason) -> None:
        await self.event_sink.emit(PlaybackStopRequestedPayload(
            intervention_id=UUID(intervention_id), reason=reason,
        ))

    async def _swap_speakers(self) -> None:
        self.speaker_mapping.swap_learners()
        self._mapping_generation += 1
        for task in self._partial_tasks.values():
            task.cancel()
        self._partial_tasks.clear()
        for label, participant in self.speaker_mapping.labels.items():
            await self._emit_mapping(label, participant)

    async def _emit_mapping(self, label: str, participant: ParticipantId) -> None:
        display = {
            ParticipantId.LEARNER_1: "Learner 1",
            ParticipantId.LEARNER_2: "Learner 2",
            ParticipantId.FLUENT_PARTNER: "Fluent partner",
        }[participant]
        await self.event_sink.emit(SpeakerMappedPayload(
            provider_label=label, participant_id=participant.value, display_label=display,
        ))

    async def _emit_cancelled(self, record: InterventionRecord, reason: CancellationReason) -> None:
        await self.event_sink.emit(InterventionCancelledPayload(
            turn_id=record.turn_id, intervention_id=record.intervention_id, reason=reason,
        ))

    def _native_code(self, participant: ParticipantId) -> str:
        if participant is ParticipantId.LEARNER_2:
            return self.config.learner2_native_language or self.config.learner1_native_language
        return self.config.learner1_native_language

    async def _activity(self, activity: Activity, delta: int) -> None:
        self._activities[activity] = max(0, self._activities[activity] + delta)
        await self._emit_status()

    async def _emit_status(self) -> None:
        if not self.stopping:
            await self.event_sink.emit(SessionStatusPayload(
                connection_state="degraded" if self._degraded or self.playback.suspended else "active",
                activities=[item for item in ACTIVITIES if self._activities[item] > 0],
            ))

    async def _degrade(self, subsystem: DegradedSubsystem, code: DegradedCode) -> None:
        if self.stopping:
            return
        fatal = subsystem == "transcription"
        self._degraded.add(subsystem)
        if fatal:
            self._accepting_audio = False
            self._stop_reason = "muse_failure"
            self._stop.set()
        await self.event_sink.emit(SessionDegradedPayload(
            subsystem=subsystem, code=code, recoverable=not fatal, restart_required=fatal,
        ))

    async def _finish(self) -> None:
        async with self._finish_lock:
            if self.closed:
                return
            self._accepting_audio = False
            self._stop.set()
            try:
                if self._transcription is not None:
                    async with asyncio.timeout(5):
                        await self._transcription.close()
            except (TimeoutError, OSError, RuntimeError):
                log_event(logger, logging.WARNING, "provider_close_failed", {
                    "session_id": str(self.session_id),
                })
            finally:
                self._transcription = None
                self._partial_tasks.clear()
                self._tasks.clear()
                self._turn_labels.clear()
                self._turn_windows.clear()
                self._windows.clear()
                self._activities.clear()
                self._degraded.clear()
                self.audio_store.clear_session(self.session_id)
                self.transcripts.clear()
                self.interventions.clear()
                self.speaker_mapping.clear()
                self.playback.clear()
                try:
                    await self.event_sink.emit(SessionEndedPayload(reason=self._stop_reason))
                finally:
                    self._closed.set()
