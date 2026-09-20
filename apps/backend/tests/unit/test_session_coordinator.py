import asyncio
from contextlib import asynccontextmanager
from dataclasses import dataclass
from uuid import UUID, uuid4

import pytest

from language_coach.domain.models import (
    SpeakerObserved,
    SpeechCompleted,
    SpeechStarted,
    TranscriptionFailure,
    TranscriptPartial,
)
from language_coach.domain.session_coordinator import ConversationCoordinator
from language_coach.protocol.models import (
    InterventionAudioRetry,
    PlaybackEnded,
    PlaybackInterrupted,
    PlaybackStarted,
    SessionConfig,
    SpeakersSwap,
)
from language_coach.providers.device_speech import DeviceSpeechSynthesizer
from language_coach.providers.interfaces import (
    AnalysisRequest,
    InterventionAnalysis,
    InterventionCandidate,
    SpeechSynthesisUnavailable,
)
from language_coach.providers.muse_transcribe import MuseStartFailed
from language_coach.services.audio_assets import InMemoryAudioStore
from language_coach.services.session_registry import SessionEventSink
from tests.fakes.clock import ManualClock, flush_tasks
from tests.fakes.providers import (
    FakeAnalyzer,
    FakeSynthesizer,
    FakeTranscriber,
    FakeTranscriptionSession,
)


def positive(source: str = "grocery store", target: str = "supermercado"):
    return InterventionAnalysis(
        interventions=[
            InterventionCandidate(
                source_text=source,
                source_language="English",
                target_text=target,
                target_language="Spanish",
            )
        ]
    )


@dataclass
class Conversation:
    coordinator: ConversationCoordinator
    session: FakeTranscriptionSession
    analyzer: FakeAnalyzer
    synthesizer: FakeSynthesizer
    sink: SessionEventSink
    clock: ManualClock
    runner: asyncio.Task[None]

    async def emit(self, *events) -> None:
        for event in events:
            await self.session.emit(event)
        await flush_tasks()

    def events(self, event_type: str):
        return [event for event in self.sink.events if event.type == event_type]

    async def make_clip(self) -> UUID:
        self.analyzer.add(positive())
        await self.emit(
            SpeechStarted("turn-a", 0),
            SpeakerObserved("turn-a", "A", 10),
            SpeechCompleted("turn-a", "Necesito grocery store", "A", 80),
        )
        await self.clock.advance_and_flush(600)
        return self.events("intervention.committed")[-1].intervention_id

    async def play_clip(self) -> UUID:
        intervention_id = await self.make_clip()
        for _ in range(10):
            await self.coordinator.accept_pcm(bytes(3840))
        await self.coordinator.handle_control(
            PlaybackStarted(
                type="playback.started",
                protocol_version=1,
                intervention_id=intervention_id,
            )
        )
        return intervention_id


@asynccontextmanager
async def conversation(
    analyzer: FakeAnalyzer | None = None,
    two_learners: bool = False,
    synthesizer=None,
):
    session_id = uuid4()
    transcriber = FakeTranscriber()
    analyzer = analyzer or FakeAnalyzer()
    synthesizer = synthesizer or FakeSynthesizer()
    sink = SessionEventSink(session_id, sender=None)
    clock = ManualClock()
    coordinator = ConversationCoordinator(
        session_id=session_id,
        config=SessionConfig(
            mode="two_learners" if two_learners else "learner_fluent",
            learning_language="es",
            learner1_native_language="en",
            learner2_native_language="fr" if two_learners else None,
        ),
        transcriber=transcriber,
        analyzer=analyzer,
        synthesizer=synthesizer,
        audio_store=InMemoryAudioStore(),
        event_sink=sink,
        clock=clock,
    )
    runner = asyncio.create_task(coordinator.run())
    try:
        await coordinator.wait_started()
        await flush_tasks()
        yield Conversation(
            coordinator, transcriber.sessions[0], analyzer, synthesizer, sink, clock, runner
        )
    finally:
        await coordinator.close()
        await runner


@pytest.mark.asyncio
async def test_final_intervention_is_spoken_after_quiet_window() -> None:
    async with conversation() as ctx:
        ctx.analyzer.add(positive())
        ctx.analyzer.add(positive())
        await ctx.emit(
            SpeechStarted("turn-a", 1000),
            SpeakerObserved("turn-a", "A", 1050),
            TranscriptPartial("turn-a", 1, "Necesito grocery store", 1200),
        )
        await ctx.clock.advance_and_flush(400)
        await ctx.emit(SpeechCompleted("turn-a", "Necesito grocery store", "A", 1500))
        await ctx.clock.advance_and_flush(599)
        assert not ctx.events("playback.start_requested")
        await ctx.clock.advance_and_flush(50)
        help_types = [e.type for e in ctx.sink.events if e.type != "session.status"]
        assert help_types == [
            "speaker.mapped", "intervention.preview", "intervention.committed",
            "intervention.audio_ready", "playback.start_requested",
        ]
        assert len(ctx.synthesizer.calls) == 1
        assert ctx.coordinator.audio_store.size_bytes == len(b"fake-mp3")
    assert ctx.coordinator.audio_store.size_bytes == 0
    assert ctx.session.closed
    assert ctx.coordinator.transcripts.count == 0


@pytest.mark.asyncio
async def test_matching_speculative_analysis_is_reused_for_the_final_turn() -> None:
    async with conversation() as ctx:
        ctx.analyzer.add(positive())
        await ctx.emit(
            SpeechStarted("turn-a", 1000),
            SpeakerObserved("turn-a", "A", 1050),
            TranscriptPartial("turn-a", 1, "Necesito grocery store", 1200),
        )
        await ctx.clock.advance_and_flush(400)
        preview = ctx.events("intervention.preview")[0]
        await ctx.emit(SpeechCompleted("turn-a", "Necesito grocery store.", "A", 1500))
        await flush_tasks()
        committed = ctx.events("intervention.committed")[0]
        assert committed.intervention_id == preview.intervention_id
        assert len(ctx.analyzer.calls) == 1
        assert not ctx.analyzer.calls[0].final


@pytest.mark.asyncio
async def test_device_speech_is_ready_without_server_audio_or_url() -> None:
    async with conversation(synthesizer=DeviceSpeechSynthesizer()) as ctx:
        await ctx.make_clip()
        ready = ctx.events("intervention.audio_ready")[-1]
        assert ready.playback_kind == "device_speech"
        assert ready.audio_url is None
        assert ctx.coordinator.audio_store.size_bytes == 0
        assert ctx.coordinator.audio_store.count == 0


@pytest.mark.asyncio
async def test_partial_before_speaker_starts_preview_when_learner_is_known() -> None:
    async with conversation() as ctx:
        ctx.analyzer.add(positive())
        await ctx.emit(
            SpeechStarted("turn-a", 100),
            TranscriptPartial("turn-a", 1, "Necesito grocery store", 180),
            SpeakerObserved("turn-a", "A", 200),
        )
        await ctx.clock.advance_and_flush(400)
        assert len(ctx.events("intervention.preview")) == 1
        assert not ctx.synthesizer.calls


@pytest.mark.asyncio
async def test_one_token_partial_waits_for_the_final_turn() -> None:
    async with conversation() as ctx:
        await ctx.emit(
            SpeechStarted("turn-a", 100),
            SpeakerObserved("turn-a", "A", 120),
            TranscriptPartial("turn-a", 1, "supermarket", 180),
        )
        await ctx.clock.advance_and_flush(400)
        assert not ctx.analyzer.calls
        ctx.analyzer.add(positive("supermarket", "supermercado"))
        await ctx.emit(SpeechCompleted("turn-a", "supermarket", "A", 800))
        await flush_tasks()
        assert len(ctx.analyzer.calls) == 1
        assert ctx.analyzer.calls[0].final


@pytest.mark.asyncio
async def test_fluent_partner_is_not_analyzed_and_target_only_turn_is_empty() -> None:
    async with conversation() as ctx:
        await ctx.emit(
            SpeechStarted("first", 0), SpeakerObserved("first", "A", 20),
            SpeechStarted("second", 80), SpeakerObserved("second", "B", 100),
            SpeechCompleted("second", "Claro", "B", 200),
            SpeechCompleted("first", "Todo bien", "A", 300),
        )
        assert [call.participant for call in ctx.analyzer.calls] == ["learner_1"]
        assert not ctx.synthesizer.calls
        assert not ctx.events("intervention.committed")


@pytest.mark.asyncio
async def test_two_learners_reverse_completion_and_swap_preserve_identity() -> None:
    async with conversation(two_learners=True) as ctx:
        await ctx.emit(
            SpeechStarted("a", 0), SpeakerObserved("a", "A", 20),
            SpeechStarted("b", 80), SpeakerObserved("b", "B", 100),
            SpeechCompleted("b", "bonjour", "B", 200),
            SpeechCompleted("a", "hello", "A", 300),
        )
        assert [(call.participant, call.native_language) for call in ctx.analyzer.calls] == [
            ("learner_2", "French"), ("learner_1", "English"),
        ]
        await ctx.coordinator.handle_control(SpeakersSwap(type="speakers.swap", protocol_version=1))
        await ctx.emit(
            SpeechStarted("a2", 400), SpeakerObserved("a2", "A", 420),
            SpeechCompleted("a2", "bonjour", "A", 500),
        )
        assert ctx.analyzer.calls[-1].native_language == "French"
        assert len(ctx.events("speaker.mapped")) == 4


class BlockedAnalyzer(FakeAnalyzer):
    def __init__(self) -> None:
        super().__init__()
        self.release = asyncio.Event()
        self.called = asyncio.Event()

    async def analyze(self, request: AnalysisRequest) -> InterventionAnalysis:
        self.calls.append(request)
        self.called.set()
        await self.release.wait()
        return positive()


@pytest.mark.asyncio
async def test_matching_inflight_preview_becomes_the_final_analysis() -> None:
    analyzer = BlockedAnalyzer()
    async with conversation(analyzer) as ctx:
        await ctx.emit(
            SpeechStarted("a", 0), SpeakerObserved("a", "A", 10),
            TranscriptPartial("a", 1, "grocery store", 20),
        )
        await ctx.clock.advance_and_flush(400)
        await analyzer.called.wait()
        await ctx.emit(TranscriptPartial("a", 2, "grocery store.", 60))
        assert len(analyzer.calls) == 1
        await ctx.emit(SpeechCompleted("a", "grocery store.", "A", 80))
        assert len(analyzer.calls) == 1
        analyzer.release.set()
        await flush_tasks()
        assert len(ctx.events("intervention.committed")) == 1
        assert len(analyzer.calls) == 1


@pytest.mark.asyncio
async def test_human_speech_is_consumed_while_final_analysis_is_pending() -> None:
    analyzer = BlockedAnalyzer()
    async with conversation(analyzer) as ctx:
        await ctx.emit(
            SpeechStarted("a", 0), SpeakerObserved("a", "A", 10),
            SpeechCompleted("a", "grocery store", "A", 80),
        )
        await analyzer.called.wait()
        await ctx.emit(SpeechStarted("b", 160))
        assert "b" in ctx.coordinator.playback.active_human_turns
        analyzer.release.set()
        await flush_tasks()
        await ctx.clock.advance_and_flush(600)
        assert not ctx.events("playback.start_requested")


@pytest.mark.asyncio
async def test_final_empty_cancels_preview_and_changed_final_replaces_it() -> None:
    async with conversation() as ctx:
        ctx.analyzer.add(positive())
        ctx.analyzer.add(positive("train station", "estación de tren"))
        await ctx.emit(
            SpeechStarted("a", 0), SpeakerObserved("a", "A", 10),
            TranscriptPartial("a", 1, "grocery store", 20),
        )
        await ctx.clock.advance_and_flush(400)
        preview = ctx.events("intervention.preview")[0]
        await ctx.emit(SpeechCompleted("a", "train station", "A", 80))
        cancelled = ctx.events("intervention.cancelled")
        assert len(cancelled) == 1
        assert cancelled[0].intervention_id == preview.intervention_id
        assert cancelled[0].reason == "final_replaced"
        assert ctx.events("intervention.committed")[0].intervention_id != preview.intervention_id

        ctx.analyzer.add(positive())
        await ctx.emit(
            SpeechStarted("b", 100), SpeakerObserved("b", "A", 110),
            TranscriptPartial("b", 1, "grocery store", 120),
        )
        await ctx.clock.advance_and_flush(400)
        await ctx.emit(SpeechCompleted("b", "Todo bien", "A", 200))
        assert ctx.events("intervention.cancelled")[-1].reason == "final_empty"


@pytest.mark.asyncio
async def test_delayed_generated_speech_after_playback_end_never_maps_a_partner() -> None:
    async with conversation(two_learners=True) as ctx:
        intervention_id = await ctx.play_clip()
        for _ in range(10):
            await ctx.coordinator.accept_pcm(bytes(3840))
        await ctx.coordinator.handle_control(
            PlaybackEnded(type="playback.ended", protocol_version=1, intervention_id=intervention_id)
        )
        count = len(ctx.analyzer.calls)
        await ctx.emit(
            SpeechStarted("echo", 880), SpeakerObserved("echo", "phone", 960),
            TranscriptPartial("echo", 1, "supermercado", 1040),
            SpeechCompleted("echo", "supermercado.", "phone", 1200),
        )
        assert ctx.coordinator.speaker_mapping.participant_for("phone") is None
        assert len(ctx.analyzer.calls) == count
        assert not ctx.events("playback.stop_requested")


@pytest.mark.asyncio
async def test_echo_prefix_does_not_interrupt_but_divergence_does() -> None:
    async with conversation(two_learners=True) as ctx:
        intervention_id = await ctx.play_clip()
        await ctx.emit(
            SpeechStarted("echo", 880),
            TranscriptPartial("echo", 1, "super", 960),
        )
        assert not ctx.events("playback.stop_requested")
        await ctx.emit(TranscriptPartial("echo", 2, "supermercado pero espera", 1040))
        assert len(ctx.events("playback.stop_requested")) == 1
        await ctx.coordinator.handle_control(
            PlaybackInterrupted(
                type="playback.interrupted", protocol_version=1,
                intervention_id=intervention_id,
            )
        )
        await ctx.emit(SpeechCompleted("echo", "supermercado pero espera", None, 1120))
        assert not ctx.coordinator.playback.active_human_turns
        await ctx.clock.advance_and_flush(3000)
        assert len(ctx.events("playback.start_requested")) == 1
        assert ctx.coordinator.playback.can_manual_replay(str(intervention_id))


@pytest.mark.asyncio
async def test_audio_failure_allows_exactly_one_retry_without_duplicate_asset() -> None:
    async with conversation() as ctx:
        ctx.synthesizer.error = SpeechSynthesisUnavailable("unavailable")
        intervention_id = await ctx.make_clip()
        assert ctx.events("intervention.audio_failed")[-1].retry_available
        retry = InterventionAudioRetry(
            type="intervention.audio_retry", protocol_version=1,
            intervention_id=intervention_id,
        )
        await asyncio.gather(
            ctx.coordinator.handle_control(retry), ctx.coordinator.handle_control(retry)
        )
        await flush_tasks()
        assert len(ctx.synthesizer.calls) == 2
        assert not ctx.events("intervention.audio_failed")[-1].retry_available
        assert ctx.coordinator.audio_store.size_bytes == 0


@pytest.mark.asyncio
async def test_lifetime_warning_and_cleanup_use_absolute_deadlines() -> None:
    async with conversation() as ctx:
        await ctx.clock.advance_and_flush(49 * 60_000)
        assert len(ctx.events("session.warning")) == 1
        await ctx.clock.advance_and_flush(60_000)
        await ctx.coordinator.wait_closed()
        assert ctx.events("session.ended")[-1].reason == "lifetime"


@pytest.mark.asyncio
async def test_transcription_failure_closes_and_clears_once() -> None:
    async with conversation() as ctx:
        await ctx.make_clip()
        await ctx.emit(TranscriptionFailure())
        await ctx.coordinator.wait_closed()
        assert ctx.events("session.ended")[-1].reason == "muse_failure"
        assert len(ctx.events("session.ended")) == 1
        assert ctx.coordinator.audio_store.size_bytes == 0
        assert ctx.session.closed


@pytest.mark.asyncio
async def test_startup_failure_resolves_start_and_closed_waiters() -> None:
    transcriber = FakeTranscriber(MuseStartFailed("safe failure"))
    session_id = uuid4()
    sink = SessionEventSink(session_id, None)
    coordinator = ConversationCoordinator(
        session_id,
        SessionConfig(mode="learner_fluent", learning_language="es", learner1_native_language="en"),
        transcriber, FakeAnalyzer(), FakeSynthesizer(), InMemoryAudioStore(), sink, ManualClock(),
    )
    runner = asyncio.create_task(coordinator.run())
    with pytest.raises(MuseStartFailed):
        await coordinator.wait_started()
    await coordinator.wait_closed()
    await runner
    assert [event.type for event in sink.events] == ["session.degraded", "session.ended"]
