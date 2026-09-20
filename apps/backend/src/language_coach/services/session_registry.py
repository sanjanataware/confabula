import asyncio
import hashlib
import secrets
from collections import deque
from collections.abc import Awaitable, Callable, Coroutine
from dataclasses import dataclass, field
from typing import Any
from uuid import UUID, uuid4

from starlette.websockets import WebSocketDisconnect

from language_coach.composition import AppDependencies
from language_coach.domain.session_coordinator import ConversationCoordinator
from language_coach.protocol.models import (
    ServerEvent,
    ServerEventAdapter,
    ServerEventPayload,
    SessionConfig,
    SessionEndedReason,
    SessionReadyPayload,
    SessionStatusPayload,
)
from language_coach.providers.interfaces import MuseStartFailed
from language_coach.services.capabilities import get_capability

type EventSender = Callable[[ServerEvent], Awaitable[None]]


class SessionUnavailable(LookupError):
    pass


class InvalidSessionState(RuntimeError):
    pass


class ResumeUnavailable(SessionUnavailable):
    pass


class SessionEventSink:
    def __init__(
        self, session_id: UUID, sender: EventSender | None, capacity: int = 512,
        send_timeout_s: float = 3,
    ) -> None:
        self.session_id = session_id
        self.sender = sender
        self.sequence = -1
        self.events: deque[ServerEvent] = deque(maxlen=capacity)
        self.lock = asyncio.Lock()
        self.on_delivery_failure: Callable[[], None] | None = None
        self.send_timeout_s = send_timeout_s

    async def emit(self, payload: ServerEventPayload) -> ServerEvent:
        failed: Callable[[], None] | None = None
        async with self.lock:
            event = self.stamp(payload)
            if self.sender is not None:
                try:
                    async with asyncio.timeout(self.send_timeout_s):
                        await self.sender(event)
                except (OSError, RuntimeError, WebSocketDisconnect):
                    failed = self.on_delivery_failure
                    self.sender = None
        if failed is not None:
            failed()
        return event

    def stamp(self, payload: ServerEventPayload) -> ServerEvent:
        event = ServerEventAdapter.validate_python({
            **payload.model_dump(),
            "protocol_version": 1,
            "session_id": self.session_id,
            "sequence": self.sequence + 1,
        })
        self.sequence = event.sequence
        self.events.append(event)
        return event

    def validate_replay(self, last_sequence: int) -> None:
        if last_sequence < 0 or last_sequence > self.sequence:
            raise ResumeUnavailable("resume unavailable")
        if self.events and last_sequence < self.events[0].sequence - 1:
            raise ResumeUnavailable("resume unavailable")

    def clear(self) -> None:
        self.sender = None
        self.on_delivery_failure = None
        self.events.clear()


@dataclass
class SessionEntry:
    session_id: UUID
    resume_token: str
    resume_digest: bytes
    attachment_id: UUID | None
    coordinator: ConversationCoordinator
    sink: SessionEventSink
    audio_started: bool = False
    start_seen: bool = False
    closing: bool = False
    replaying: bool = False
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    cleaned: asyncio.Event = field(default_factory=asyncio.Event)
    used_attachments: set[UUID] = field(default_factory=set)
    runner_task: asyncio.Task[None] | None = None
    monitor_task: asyncio.Task[None] | None = None
    expiry_task: asyncio.Task[None] | None = None
    silence_task: asyncio.Task[None] | None = None
    disconnect_deadline_ms: int | None = None


@dataclass(frozen=True)
class CreatedSession:
    session_id: UUID
    resume_token: str


class SessionRegistry:
    def __init__(self, dependencies: AppDependencies, replay_timeout_s: float = 3) -> None:
        self.dependencies = dependencies
        self.replay_timeout_s = replay_timeout_s
        self._entries: dict[UUID, SessionEntry] = {}
        self._retiring: dict[UUID, SessionEntry] = {}
        self._background_tasks: set[asyncio.Task[None]] = set()
        self._dummy_resume_digest = hashlib.sha256(b"missing-session").digest()

    @property
    def active_count(self) -> int:
        return len(self._entries)

    def memory_counts(self) -> dict[str, int]:
        return {
            "sessions": len(self._entries),
            "transcript_turns": sum(entry.coordinator.transcripts.count for entry in self._entries.values()),
            "interventions": sum(entry.coordinator.interventions.count for entry in self._entries.values()),
            "events": sum(len(entry.sink.events) for entry in self._entries.values()),
            "audio_bytes": self.dependencies.audio_store.size_bytes,
        }

    def get_entry(self, session_id: UUID) -> SessionEntry:
        try:
            return self._entries[session_id]
        except KeyError:
            raise SessionUnavailable("session unavailable") from None

    async def create(
        self, config: SessionConfig, attachment_id: UUID, sender: EventSender | None = None,
    ) -> CreatedSession:
        for code in (config.learning_language, config.learner1_native_language, config.learner2_native_language):
            if code is not None:
                get_capability(code)
        session_id = uuid4()
        resume_token = secrets.token_urlsafe(32)
        sink = SessionEventSink(session_id, sender)
        base_url = self.dependencies.settings.backend_public_base_url.rstrip("/")
        coordinator = ConversationCoordinator(
            session_id=session_id, config=config,
            transcriber=self.dependencies.transcriber,
            analyzer=self.dependencies.analyzer,
            synthesizer=self.dependencies.synthesizer,
            audio_store=self.dependencies.audio_store,
            event_sink=sink, clock=self.dependencies.clock,
            audio_url_factory=lambda current, asset: f"{base_url}/v1/sessions/{current}/audio/{asset}",
        )
        entry = SessionEntry(
            session_id=session_id, resume_token=resume_token,
            resume_digest=self._digest(resume_token), attachment_id=attachment_id,
            coordinator=coordinator, sink=sink, used_attachments={attachment_id},
        )
        self._entries[session_id] = entry
        self._bind_sender(entry, attachment_id, sender)
        await sink.emit(SessionReadyPayload(resume_token=resume_token, resumed=False))
        await sink.emit(SessionStatusPayload(connection_state="idle", activities=[]))
        return CreatedSession(session_id, resume_token)

    async def start_audio(self, session_id: UUID, attachment_id: UUID) -> None:
        entry = self.get_entry(session_id)
        error: MuseStartFailed | None = None
        async with entry.lock:
            self._require_attachment(entry, attachment_id)
            if entry.start_seen:
                raise InvalidSessionState("audio already started on this attachment")
            entry.start_seen = True
            await entry.sink.emit(SessionStatusPayload(connection_state="connecting", activities=[]))
            if entry.runner_task is None:
                entry.runner_task = asyncio.create_task(entry.coordinator.run())
                entry.monitor_task = self._background(self._monitor(entry))
                try:
                    await entry.coordinator.wait_started()
                except MuseStartFailed as failed:
                    error = failed
            if error is None:
                if entry.coordinator.stopping:
                    raise InvalidSessionState("session has ended")
                await self._cancel_tasks(entry.silence_task)
                entry.silence_task = None
                entry.audio_started = True
                entry.coordinator.resume_audio()
                await entry.sink.emit(SessionStatusPayload(
                    connection_state="active", activities=["listening"],
                ))
        if error is not None:
            await self.close(session_id, "muse_failure")
            raise error

    async def accept_audio(self, session_id: UUID, attachment_id: UUID, frame: bytes) -> None:
        entry = self.get_entry(session_id)
        async with entry.lock:
            self._require_attachment(entry, attachment_id)
            if not entry.audio_started:
                raise InvalidSessionState("audio has not started")
            await entry.coordinator.accept_pcm(frame)

    async def stop_audio(self, session_id: UUID, attachment_id: UUID) -> None:
        entry = self.get_entry(session_id)
        async with entry.lock:
            self._require_attachment(entry, attachment_id)
            entry.audio_started = False
            entry.coordinator.playback.suspended = True

    async def control(self, session_id: UUID, attachment_id: UUID, message: object) -> None:
        entry = self.get_entry(session_id)
        async with entry.lock:
            self._require_attachment(entry, attachment_id)
            if not entry.audio_started:
                raise InvalidSessionState("audio has not started")
            await entry.coordinator.handle_control(message)

    async def disconnect(self, session_id: UUID, attachment_id: UUID) -> None:
        entry = self._entries.get(session_id)
        if entry is None:
            return
        async with entry.lock:
            if entry.closing or entry.attachment_id != attachment_id:
                return
            entry.attachment_id = None
            entry.audio_started = False
            entry.disconnect_deadline_ms = self.dependencies.clock.now_ms() + 15_000
            async with entry.sink.lock:
                self._bind_sender(entry, None, None)
            if entry.runner_task is not None and not entry.coordinator.stopping:
                await entry.coordinator.handle_connection_lost()
            self._arm_grace(entry)

    async def resume(
        self, session_id: UUID, attachment_id: UUID, resume_token: str, last_sequence: int,
        sender: EventSender | None = None,
    ) -> CreatedSession:
        entry = self._entries.get(session_id)
        expected = entry.resume_digest if entry is not None else self._dummy_resume_digest
        valid = secrets.compare_digest(expected, self._digest(resume_token))
        if entry is None or not valid:
            raise ResumeUnavailable("resume unavailable")
        async with entry.lock, entry.sink.lock:
            deadline = entry.disconnect_deadline_ms
            if (
                entry.closing or entry.coordinator.stopping or entry.attachment_id is not None
                or attachment_id in entry.used_attachments or deadline is None
                or self.dependencies.clock.now_ms() >= deadline
            ):
                raise ResumeUnavailable("resume unavailable")
            entry.sink.validate_replay(last_sequence)
            entry.replaying = True
            entry.attachment_id = attachment_id
            entry.used_attachments.add(attachment_id)
            await self._cancel_tasks(entry.expiry_task, entry.silence_task)
            entry.expiry_task = entry.silence_task = None
            try:
                async with asyncio.timeout(self.replay_timeout_s):
                    for event in tuple(entry.sink.events):
                        if event.sequence > last_sequence and sender is not None:
                            await sender(event)
                    ready = entry.sink.stamp(SessionReadyPayload(
                        resume_token=entry.resume_token, resumed=True,
                    ))
                    if sender is not None:
                        await sender(ready)
                entry.replaying = False
                entry.disconnect_deadline_ms = None
                entry.audio_started = False
                entry.start_seen = False
                self._bind_sender(entry, attachment_id, sender)
            except (OSError, RuntimeError, WebSocketDisconnect, asyncio.CancelledError) as error:
                entry.replaying = False
                entry.attachment_id = None
                self._bind_sender(entry, None, None)
                self._arm_grace(entry)
                if isinstance(error, asyncio.CancelledError):
                    raise
                raise ResumeUnavailable("resume unavailable") from None
            return CreatedSession(entry.session_id, entry.resume_token)

    async def close(
        self, session_id: UUID, reason: SessionEndedReason = "user_end",
        attachment_id: UUID | None = None,
    ) -> None:
        entry = self._entries.get(session_id) or self._retiring.get(session_id)
        if entry is None:
            return
        async with entry.lock:
            if attachment_id is not None:
                self._require_attachment(entry, attachment_id)
            owner = self._begin_close(entry)
        if owner:
            await self._dispose(entry, reason)
        else:
            await entry.cleaned.wait()

    def _begin_close(self, entry: SessionEntry) -> bool:
        if entry.closing:
            return False
        entry.closing = True
        entry.audio_started = False
        self._entries.pop(entry.session_id, None)
        self._retiring[entry.session_id] = entry
        return True

    async def _dispose(self, entry: SessionEntry, reason: SessionEndedReason) -> None:
        try:
            await self._cancel_tasks(entry.expiry_task, entry.silence_task, entry.monitor_task)
            await entry.coordinator.close(reason)
            await entry.coordinator.wait_closed()
            if entry.runner_task is not None:
                await asyncio.gather(entry.runner_task, return_exceptions=True)
        finally:
            async with entry.sink.lock:
                entry.sink.clear()
            entry.resume_token = ""
            entry.resume_digest = b""
            entry.attachment_id = None
            entry.used_attachments.clear()
            entry.disconnect_deadline_ms = None
            entry.expiry_task = entry.silence_task = entry.monitor_task = None
            self._retiring.pop(entry.session_id, None)
            entry.cleaned.set()

    async def shutdown(self) -> None:
        for session_id in list(self._entries):
            await self.close(session_id, "shutdown")
        for entry in tuple(self._retiring.values()):
            await entry.cleaned.wait()
        await self._cancel_tasks(*tuple(self._background_tasks))

    async def _monitor(self, entry: SessionEntry) -> None:
        await entry.coordinator.wait_closed()
        await self.close(entry.session_id)

    def _arm_grace(self, entry: SessionEntry) -> None:
        entry.expiry_task = self._background(self._expire(entry))
        if entry.runner_task is not None and not entry.coordinator.stopping:
            entry.silence_task = self._background(self._fill_silence(entry))

    async def _fill_silence(self, entry: SessionEntry) -> None:
        while not entry.closing and entry.attachment_id is None:
            await self.dependencies.clock.sleep_ms(80)
            if entry.closing or entry.attachment_id is not None:
                return
            if entry.disconnect_deadline_ms is None or self.dependencies.clock.now_ms() >= entry.disconnect_deadline_ms:
                return
            try:
                await entry.coordinator.accept_pcm(bytes(3840))
            except RuntimeError:
                return

    async def _expire(self, entry: SessionEntry) -> None:
        deadline = entry.disconnect_deadline_ms
        if deadline is None:
            return
        await self.dependencies.clock.sleep_ms(max(0, deadline - self.dependencies.clock.now_ms()))
        async with entry.lock:
            if entry.closing or entry.attachment_id is not None or entry.disconnect_deadline_ms != deadline:
                return
            if not self._begin_close(entry):
                return
        await self._dispose(entry, "disconnect_timeout")

    def _bind_sender(self, entry: SessionEntry, attachment_id: UUID | None, sender: EventSender | None) -> None:
        entry.sink.sender = sender
        if attachment_id is None or sender is None:
            entry.sink.on_delivery_failure = None
        else:
            def detach() -> None:
                self._background(self.disconnect(entry.session_id, attachment_id))
            entry.sink.on_delivery_failure = detach

    def _background(self, work: Coroutine[Any, Any, None]) -> asyncio.Task[None]:
        task = asyncio.create_task(work)
        self._background_tasks.add(task)
        task.add_done_callback(self._background_tasks.discard)
        return task

    @staticmethod
    async def _cancel_tasks(*tasks: asyncio.Task[None] | None) -> None:
        current = asyncio.current_task()
        cancellable = [task for task in tasks if task is not None and task is not current]
        for task in cancellable:
            task.cancel()
        await asyncio.gather(*cancellable, return_exceptions=True)

    @staticmethod
    def _require_attachment(entry: SessionEntry, attachment_id: UUID) -> None:
        if entry.closing or entry.replaying or entry.attachment_id != attachment_id:
            raise SessionUnavailable("session unavailable")

    @staticmethod
    def _digest(token: str) -> bytes:
        return hashlib.sha256(token.encode()).digest()
