import asyncio
import json
from pathlib import Path
from uuid import UUID

import pytest

from language_coach.domain.models import (
    SpeechCompleted,
    TranscriptionFailure,
    TranscriptPartial,
)
from language_coach.providers.interfaces import (
    InvalidPcmFrame,
    MuseStartFailed,
    TranscriptionConfig,
)
from language_coach.providers.muse_transcribe import (
    MuseEventNormalizer,
    MuseTranscriber,
    MuseTranscriptionSession,
    build_handshake,
)
from tests.fakes.clock import flush_tasks

FIXTURES = Path(__file__).parents[1] / "fixtures" / "muse"


def test_handshake_uses_exact_realtime_contract() -> None:
    config = TranscriptionConfig(
        UUID("00000000-0000-4000-8000-000000000001"),
        ("English", "Spanish", "English"),
    )
    assert build_handshake("test-key", config) == {
        "authorization": {"accessToken": "Bearer test-key"},
        "audioEncoding": "PCM_24KHZ",
        "model": "muse-voice-transcribe-1.0",
        "mode": "DIARIZATION",
        "partialMode": "CUMULATIVE",
        "emitAudioProgress": True,
        "languageBias": ["English", "Spanish"],
    }


def test_cumulative_partial_revises_the_open_turn() -> None:
    normalizer = MuseEventNormalizer()
    events = []
    for payload in json.loads((FIXTURES / "partial.json").read_text()):
        events.extend(normalizer.feed(payload))
    events.extend(normalizer.feed(json.loads((FIXTURES / "revised-partial.json").read_text())))
    partials = [event for event in events if isinstance(event, TranscriptPartial)]
    assert [(item.turn_id, item.revision, item.text) for item in partials] == [
        ("1", 1, "how is the"),
        ("1", 2, "how is the weather"),
    ]


def test_overlapping_turns_complete_without_swapping_labels() -> None:
    normalizer = MuseEventNormalizer()
    events = []
    for line in (FIXTURES / "overlapping-turns.jsonl").read_text().splitlines():
        events.extend(normalizer.feed(json.loads(line)))
    completed = [event for event in events if isinstance(event, SpeechCompleted)]
    assert [(item.turn_id, item.speaker_label, item.text) for item in completed] == [
        ("2", "B", "Claro."),
        ("1", "A", "I need the grocery store."),
    ]


def test_progress_unknown_events_and_duplicate_start_do_not_revise_turns() -> None:
    normalizer = MuseEventNormalizer()
    start = {"type": "speechStart", "turnId": 1, "audioProcessedMs": 0}
    normalizer.feed(start)
    normalizer.feed({"type": "transcript", "transcript": "first", "audioProcessedMs": 80})
    assert normalizer.feed(start) == []
    assert normalizer.feed({"type": "audioProgress", "audioProcessedMs": 160}) == []
    assert normalizer.feed({"type": "futureMessage"}) == []
    assert normalizer.latest_audio_processed_ms == 160
    assert normalizer.turns["1"].revision == 1
    assert normalizer.turns["1"].text == "first"


class FakeTransport:
    def __init__(self, stalls: bool = False) -> None:
        self.sent: list[str | bytes] = []
        self.incoming: asyncio.Queue[str | Exception] = asyncio.Queue()
        self.close_calls = 0
        self.stalls = stalls
        self.aborted = False
        self.transport = self

    async def send(self, data: str | bytes) -> None:
        self.sent.append(data)
        if isinstance(data, str) and json.loads(data).get("type") == "endStream":
            if self.stalls:
                await asyncio.Event().wait()
            self.incoming.put_nowait(StopAsyncIteration())

    async def recv(self) -> str:
        message = await self.incoming.get()
        if isinstance(message, Exception):
            raise message
        return message

    async def close(self) -> None:
        self.close_calls += 1

    def abort(self) -> None:
        self.aborted = True


@pytest.mark.asyncio
async def test_frame_guard_runs_before_transport_and_graceful_close_is_idempotent() -> None:
    transport = FakeTransport()
    session = MuseTranscriptionSession(transport)
    with pytest.raises(InvalidPcmFrame):
        await session.send_pcm(bytes(100))
    assert not transport.sent
    await session.send_pcm(bytes(3840))
    await session.close()
    await session.close()
    assert transport.close_calls == 1
    assert json.loads(transport.sent[-1]) == {"type": "endStream"}
    assert [item async for item in session.events()] == []


@pytest.mark.asyncio
async def test_stalled_end_stream_is_bounded_and_receiver_is_joined() -> None:
    transport = FakeTransport(stalls=True)
    session = MuseTranscriptionSession(transport, graceful_close_timeout_s=0)
    async with asyncio.timeout(0.2):
        await session.close()
        assert [item async for item in session.events()] == []
    assert transport.close_calls == 1


@pytest.mark.asyncio
async def test_error_or_unexpected_closure_emits_one_safe_failure() -> None:
    for response in (
        json.dumps({"type": "error", "message": "private-transcript-and-key"}),
        StopAsyncIteration(),
        json.dumps({"type": "speechStart", "turnId": None, "audioProcessedMs": 0}),
    ):
        transport = FakeTransport()
        transport.incoming.put_nowait(response)
        session = MuseTranscriptionSession(transport, graceful_close_timeout_s=0)
        await flush_tasks()
        events = [item async for item in session.events()]
        assert len(events) == 1 and isinstance(events[0], TranscriptionFailure)
        assert "private-transcript-and-key" not in repr(events)
        await session.close()


@pytest.mark.asyncio
async def test_error_ack_with_session_id_cannot_start_audio() -> None:
    transport = FakeTransport()
    transport.incoming.put_nowait(json.dumps({
        "type": "error", "sessionId": "fixture", "message": "private-provider-prose",
    }))

    async def connect(url, **kwargs):
        return transport

    transcriber = MuseTranscriber("test-key", connector=connect)
    with pytest.raises(MuseStartFailed, match="Muse"):
        await transcriber.open(TranscriptionConfig(UUID(int=1), ("English", "Spanish")))
    assert transport.close_calls == 1
