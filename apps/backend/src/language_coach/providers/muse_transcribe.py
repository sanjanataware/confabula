import asyncio
import json
import logging
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any, Protocol, cast
from urllib.parse import urlencode

import websockets

from language_coach.domain.models import (
    SpeakerObserved,
    SpeechCompleted,
    SpeechEnded,
    SpeechStarted,
    TranscriptionEvent,
    TranscriptionFailure,
    TranscriptPartial,
)
from language_coach.providers.interfaces import (
    InvalidPcmFrame,
    MuseStartFailed,
    TranscriptionConfig,
    TranscriptionSession,
)

FRAME_BYTES = 3_840


class WebSocketTransport(Protocol):
    async def send(self, data: str | bytes) -> None: ...

    async def recv(self) -> str | bytes: ...

    async def close(self) -> None: ...


@dataclass
class _ProviderTurn:
    turn_id: str
    started_at_ms: int
    open: bool = True
    final: bool = False
    revision: int = 0
    text: str = ""
    speaker_label: str | None = None
    ended_at_ms: int | None = None


class MuseEventNormalizer:
    def __init__(self) -> None:
        self._turns: dict[str, _ProviderTurn] = {}
        self._open_order: list[str] = []
        self.latest_audio_processed_ms = 0

    @property
    def turns(self) -> dict[str, _ProviderTurn]:
        return dict(self._turns)

    def feed(self, payload: dict[str, Any]) -> list[TranscriptionEvent]:
        event_type = payload.get("type")
        audio_ms = self._audio_ms(payload)
        if event_type == "audioProgress":
            self.latest_audio_processed_ms = max(self.latest_audio_processed_ms, audio_ms)
            return []
        if event_type == "speechStart":
            turn_id = self._turn_id(payload)
            if turn_id in self._turns:
                return []
            started_turn = _ProviderTurn(turn_id=turn_id, started_at_ms=audio_ms)
            self._turns[turn_id] = started_turn
            self._open_order = [item for item in self._open_order if item != turn_id]
            self._open_order.append(turn_id)
            return [SpeechStarted(turn_id, audio_ms)]
        if event_type == "transcript":
            active_turn = self._latest_open_turn()
            if active_turn is None or active_turn.final:
                return []
            active_turn.revision += 1
            active_turn.text = self._text(payload)
            return [
                TranscriptPartial(
                    active_turn.turn_id,
                    active_turn.revision,
                    active_turn.text,
                    audio_ms,
                )
            ]
        if event_type == "speaker":
            speaker_turn = self._speaker_turn(audio_ms)
            label = payload.get("label")
            if speaker_turn is None or not isinstance(label, str) or not label:
                return []
            speaker_turn.speaker_label = label
            return [SpeakerObserved(speaker_turn.turn_id, label, audio_ms)]
        if event_type == "speechEnd":
            turn_id = self._turn_id(payload)
            ending_turn = self._turns.get(turn_id)
            if ending_turn is not None:
                ending_turn.open = False
                ending_turn.ended_at_ms = audio_ms
                self._open_order = [item for item in self._open_order if item != turn_id]
            return [SpeechEnded(turn_id, audio_ms)]
        if event_type == "speechComplete":
            turn_id = self._turn_id(payload)
            completed_turn = self._turns.get(turn_id)
            if completed_turn is None:
                raise ValueError("Muse completed an unknown turn")
            if completed_turn.final:
                return []
            completed_turn.final = True
            completed_turn.open = False
            completed_turn.text = self._text(payload)
            self._open_order = [item for item in self._open_order if item != turn_id]
            return [
                SpeechCompleted(
                    turn_id=turn_id,
                    text=completed_turn.text,
                    speaker_label=completed_turn.speaker_label,
                    audio_processed_ms=audio_ms,
                )
            ]
        if event_type == "error":
            return [TranscriptionFailure()]
        return []

    def _latest_open_turn(self) -> _ProviderTurn | None:
        for turn_id in reversed(self._open_order):
            turn = self._turns[turn_id]
            if turn.open and not turn.final:
                return turn
        return None

    def _speaker_turn(self, audio_ms: int) -> _ProviderTurn | None:
        for turn_id in reversed(self._open_order):
            turn = self._turns[turn_id]
            if (
                turn.open
                and turn.speaker_label is None
                and turn.started_at_ms <= audio_ms
                and (turn.ended_at_ms is None or audio_ms <= turn.ended_at_ms)
            ):
                return turn
        return None

    def clear(self) -> None:
        self._turns.clear()
        self._open_order.clear()
        self.latest_audio_processed_ms = 0

    @staticmethod
    def _turn_id(payload: dict[str, Any]) -> str:
        value = payload.get("turnId")
        if isinstance(value, bool) or not isinstance(value, (str, int)):
            raise TypeError("Muse event omitted turnId")
        return str(value)

    @staticmethod
    def _audio_ms(payload: dict[str, Any]) -> int:
        value = payload.get("audioProcessedMs", 0)
        if isinstance(value, bool) or not isinstance(value, int) or value < 0:
            raise ValueError("Muse event has an invalid audio timestamp")
        return value

    @staticmethod
    def _text(payload: dict[str, Any]) -> str:
        value = payload.get("transcript")
        if not isinstance(value, str):
            raise TypeError("Muse event omitted transcript text")
        return value


def build_handshake(api_key: str, config: TranscriptionConfig) -> dict[str, object]:
    return {
        "authorization": {"accessToken": f"Bearer {api_key}"},
        "audioEncoding": config.encoding,
        "model": config.model,
        "mode": config.mode,
        "partialMode": config.partial_mode,
        "emitAudioProgress": True,
        "languageBias": list(dict.fromkeys(config.muse_bias_names)),
    }


async def close_transport(transport: WebSocketTransport, timeout_s: float = 1) -> None:
    try:
        async with asyncio.timeout(timeout_s):
            await transport.close()
    except (OSError, RuntimeError, websockets.WebSocketException):
        underlying = getattr(transport, "transport", None)
        if underlying is not None:
            underlying.abort()


class MuseTranscriptionSession(TranscriptionSession):
    def __init__(
        self, transport: WebSocketTransport, graceful_close_timeout_s: float = 3,
    ) -> None:
        self._transport = transport
        self._normalizer = MuseEventNormalizer()
        self._events: asyncio.Queue[TranscriptionEvent | None] = asyncio.Queue()
        self._closing = False
        self._closed = False
        self._cleaned = False
        self._failed = False
        self._close_lock = asyncio.Lock()
        self._graceful_close_timeout_s = graceful_close_timeout_s
        self._receiver = asyncio.create_task(self._receive())

    async def send_pcm(self, frame: bytes) -> None:
        if len(frame) != FRAME_BYTES:
            raise InvalidPcmFrame("PCM frames must be exactly 3,840 bytes")
        if self._closing or self._closed:
            raise RuntimeError("transcription session is closed")
        try:
            async with asyncio.timeout(1):
                await self._transport.send(frame)
        except (OSError, websockets.WebSocketException):
            self._emit_failure()
            raise RuntimeError("Muse audio transport unavailable") from None

    def _emit_failure(self) -> None:
        if not self._closing and not self._failed:
            self._failed = True
            self._events.put_nowait(TranscriptionFailure())

    async def _receive(self) -> None:
        try:
            while True:
                raw = await self._transport.recv()
                if isinstance(raw, bytes):
                    continue
                payload = json.loads(raw)
                if not isinstance(payload, dict):
                    raise TypeError("invalid Muse envelope")
                for event in self._normalizer.feed(payload):
                    if isinstance(event, TranscriptionFailure):
                        self._emit_failure()
                        return
                    self._events.put_nowait(event)
        except (ValueError, TypeError, OSError, RuntimeError, StopAsyncIteration, websockets.WebSocketException):
            self._emit_failure()
        finally:
            self._closed = True
            self._events.put_nowait(None)

    async def events(self) -> AsyncIterator[TranscriptionEvent]:
        while not self._closed or not self._events.empty():
            event = await self._events.get()
            if event is None:
                return
            yield event

    async def close(self) -> None:
        async with self._close_lock:
            if self._cleaned:
                return
            self._closing = True
            try:
                async with asyncio.timeout(self._graceful_close_timeout_s):
                    await self._transport.send(json.dumps({"type": "endStream"}))
                    await asyncio.shield(self._receiver)
            except (OSError, RuntimeError, websockets.WebSocketException):
                pass
            finally:
                if not self._receiver.done():
                    self._receiver.cancel()
                await asyncio.gather(self._receiver, return_exceptions=True)
                await close_transport(self._transport)
                self._closed = True
                self._cleaned = True
                self._normalizer.clear()
                while not self._events.empty():
                    self._events.get_nowait()
                self._events.put_nowait(None)


class MuseTranscriber:
    def __init__(
        self,
        api_key: str,
        connector: Any | None = None,
        connect_timeout_s: float = 10,
        graceful_close_timeout_s: float = 3,
    ) -> None:
        self._api_key = api_key
        self._connector = connector or websockets.connect
        self._connect_timeout_s = connect_timeout_s
        self._graceful_close_timeout_s = graceful_close_timeout_s
        self._transport_logger = logging.getLogger("language_coach.muse_transport")
        self._transport_logger.disabled = True

    async def open(self, config: TranscriptionConfig) -> MuseTranscriptionSession:
        query = urlencode({"sessionId": str(config.application_session_id)})
        url = f"wss://api.meta.ai/v1/asr/realtime?{query}"
        transport: WebSocketTransport | None = None
        try:
            async with asyncio.timeout(self._connect_timeout_s):
                transport = cast(
                    WebSocketTransport,
                    await self._connector(url, close_timeout=1, logger=self._transport_logger),
                )
                await transport.send(json.dumps(build_handshake(self._api_key, config)))
                raw_ack = await transport.recv()
                ack = json.loads(raw_ack) if isinstance(raw_ack, str) else None
                if (
                    not isinstance(ack, dict) or ack.get("type") == "error"
                    or not isinstance(ack.get("sessionId"), str) or not ack["sessionId"]
                ):
                    raise MuseStartFailed("Muse handshake failed")
        except (OSError, RuntimeError, ValueError, TypeError, websockets.WebSocketException, asyncio.CancelledError) as error:
            if transport is not None:
                await close_transport(transport)
            if isinstance(error, asyncio.CancelledError):
                raise
            raise MuseStartFailed("Muse connection failed") from None
        return MuseTranscriptionSession(
            transport,
            graceful_close_timeout_s=self._graceful_close_timeout_s,
        )
