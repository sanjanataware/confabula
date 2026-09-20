import asyncio
from uuid import uuid4

import pytest

from language_coach.composition import AppDependencies
from language_coach.config import Settings
from language_coach.domain.models import TranscriptionFailure
from language_coach.protocol.models import (
    ServerEvent,
    SessionConfig,
    SessionStatusPayload,
)
from language_coach.services.audio_assets import InMemoryAudioStore
from language_coach.services.pairing import PairingToken
from language_coach.services.session_registry import (
    InvalidSessionState,
    ResumeUnavailable,
    SessionRegistry,
)
from tests.fakes.clock import ManualClock, flush_tasks
from tests.fakes.providers import FakeAnalyzer, FakeSynthesizer, FakeTranscriber

CONFIG = SessionConfig(
    mode="learner_fluent", learning_language="es", learner1_native_language="en"
)


def dependencies(clock: ManualClock) -> AppDependencies:
    return AppDependencies(
        settings=Settings(
            _env_file=None,
            muse_api_key="muse",
            labs_api_key="labs",
            labs_voice_id="voice",
            allowed_origins=["https://localhost:8443"],
            backend_public_base_url="https://localhost:8444",
        ),
        pairing_token=PairingToken("p" * 43),
        transcriber=FakeTranscriber(),
        analyzer=FakeAnalyzer(),
        synthesizer=FakeSynthesizer(),
        audio_store=InMemoryAudioStore(),
        clock=clock,
    )


@pytest.mark.asyncio
async def test_resume_replays_missed_events_and_keeps_coordinator() -> None:
    registry = SessionRegistry(dependencies(ManualClock()))
    first_attachment = uuid4()
    created = await registry.create(CONFIG, first_attachment)
    entry = registry.get_entry(created.session_id)
    assert [event.sequence for event in entry.sink.events] == [0, 1]
    await registry.disconnect(created.session_id, first_attachment)
    replayed: list[ServerEvent] = []

    async def send(event: ServerEvent) -> None:
        replayed.append(event)

    second_attachment = uuid4()
    try:
        await registry.resume(
            created.session_id, second_attachment, created.resume_token, 0, send,
        )
        assert [event.sequence for event in replayed] == [1, 2]
        assert replayed[-1].type == "session.ready" and replayed[-1].resumed
        assert registry.get_entry(created.session_id).coordinator is entry.coordinator
        await registry.disconnect(created.session_id, first_attachment)
        assert entry.attachment_id == second_attachment
    finally:
        await registry.shutdown()
    assert registry.active_count == 0
    assert not entry.sink.events


@pytest.mark.asyncio
async def test_detached_silence_is_paced_and_resume_reuses_provider() -> None:
    clock = ManualClock()
    deps = dependencies(clock)
    registry = SessionRegistry(deps)
    first = uuid4()
    created = await registry.create(CONFIG, first)
    try:
        await registry.start_audio(created.session_id, first)
        provider = deps.transcriber.sessions[0]
        await registry.disconnect(created.session_id, first)
        await clock.advance_and_flush(79)
        assert provider.sent_frames == []
        await clock.advance_and_flush(1)
        assert provider.sent_frames == [bytes(3840)]
        replacement = uuid4()
        entry = registry.get_entry(created.session_id)
        await registry.resume(
            created.session_id, replacement, created.resume_token, entry.sink.sequence,
        )
        await registry.start_audio(created.session_id, replacement)
        await clock.advance_and_flush(80)
        assert len(provider.sent_frames) == 1
        assert not entry.coordinator.playback.suspended
        await registry.accept_audio(created.session_id, replacement, b"\x01" * 3840)
        assert provider.sent_frames[-1] == b"\x01" * 3840
        assert len(deps.transcriber.sessions) == 1
        with pytest.raises(InvalidSessionState):
            await registry.start_audio(created.session_id, replacement)
    finally:
        await registry.shutdown()


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["token", "ahead", "old", "reused_attachment"])
async def test_invalid_resume_keeps_original_grace_tasks_armed(failure: str) -> None:
    clock = ManualClock()
    deps = dependencies(clock)
    registry = SessionRegistry(deps)
    first = uuid4()
    created = await registry.create(CONFIG, first)
    try:
        await registry.start_audio(created.session_id, first)
        entry = registry.get_entry(created.session_id)
        if failure == "old":
            for _ in range(520):
                await entry.sink.emit(SessionStatusPayload(connection_state="active", activities=[]))
        await registry.disconnect(created.session_id, first)
        expiry, filler, deadline = entry.expiry_task, entry.silence_task, entry.disconnect_deadline_ms
        token = "x" * 43 if failure == "token" else created.resume_token
        sequence = entry.sink.sequence + 1 if failure == "ahead" else 0 if failure == "old" else entry.sink.sequence
        attachment = first if failure == "reused_attachment" else uuid4()
        with pytest.raises(ResumeUnavailable):
            await registry.resume(created.session_id, attachment, token, sequence)
        assert entry.expiry_task is expiry
        assert entry.silence_task is filler
        assert entry.disconnect_deadline_ms == deadline
        await clock.advance_and_flush(15_000)
        assert registry.active_count == 0
        assert deps.transcriber.sessions[0].closed
        assert not entry.sink.events
    finally:
        await registry.shutdown()


@pytest.mark.asyncio
async def test_provider_failure_while_detached_revokes_resume_and_audio() -> None:
    clock = ManualClock()
    deps = dependencies(clock)
    registry = SessionRegistry(deps)
    attachment = uuid4()
    created = await registry.create(CONFIG, attachment)
    try:
        await registry.start_audio(created.session_id, attachment)
        entry = registry.get_entry(created.session_id)
        await registry.disconnect(created.session_id, attachment)
        await deps.transcriber.sessions[0].emit(TranscriptionFailure())
        await flush_tasks()
        assert registry.active_count == 0
        with pytest.raises(ResumeUnavailable):
            await registry.resume(created.session_id, uuid4(), created.resume_token, 0)
        assert not entry.sink.events
    finally:
        await registry.shutdown()


@pytest.mark.asyncio
async def test_event_emitted_during_replay_is_delivered_once_after_ready() -> None:
    registry = SessionRegistry(dependencies(ManualClock()))
    attachment = uuid4()
    created = await registry.create(CONFIG, attachment)
    await registry.disconnect(created.session_id, attachment)
    entry = registry.get_entry(created.session_id)
    replay_started, release = asyncio.Event(), asyncio.Event()
    delivered: list[int] = []

    async def send(event: ServerEvent) -> None:
        if event.sequence == 1:
            replay_started.set()
            await release.wait()
        delivered.append(event.sequence)

    resume = asyncio.create_task(registry.resume(
        created.session_id, uuid4(), created.resume_token, 0, send,
    ))
    await replay_started.wait()
    produced = asyncio.create_task(entry.sink.emit(
        SessionStatusPayload(connection_state="active", activities=["listening"])
    ))
    release.set()
    await resume
    await produced
    assert delivered == [1, 2, 3]
    await registry.shutdown()


@pytest.mark.asyncio
async def test_failed_replay_restores_only_the_remaining_grace_period() -> None:
    clock = ManualClock()
    deps = dependencies(clock)
    registry = SessionRegistry(deps)
    attachment = uuid4()
    created = await registry.create(CONFIG, attachment)
    try:
        await registry.start_audio(created.session_id, attachment)
        await registry.disconnect(created.session_id, attachment)
        await clock.advance_and_flush(10_000)
        entry = registry.get_entry(created.session_id)

        async def broken_send(event: ServerEvent) -> None:
            raise OSError("closed socket")

        with pytest.raises(ResumeUnavailable):
            await registry.resume(created.session_id, uuid4(), created.resume_token, 0, broken_send)
        assert entry.disconnect_deadline_ms == 15_000
        assert entry.attachment_id is None
        await clock.advance_and_flush(4999)
        assert registry.active_count == 1
        await clock.advance_and_flush(1)
        assert registry.active_count == 0
        assert deps.transcriber.sessions[0].closed
    finally:
        await registry.shutdown()


@pytest.mark.asyncio
async def test_blocked_replay_is_bounded_and_does_not_hold_lifecycle_lock() -> None:
    clock = ManualClock()
    registry = SessionRegistry(dependencies(clock), replay_timeout_s=0)
    attachment = uuid4()
    created = await registry.create(CONFIG, attachment)
    await registry.disconnect(created.session_id, attachment)

    async def blocked_send(event: ServerEvent) -> None:
        await asyncio.Event().wait()

    with pytest.raises(ResumeUnavailable):
        await registry.resume(created.session_id, uuid4(), created.resume_token, 0, blocked_send)
    await registry.shutdown()
    assert registry.active_count == 0
