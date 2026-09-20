import asyncio
from uuid import UUID, uuid4

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import ValidationError
from starlette.websockets import WebSocketState

from language_coach.config import Settings
from language_coach.protocol.codec import encode_server_event, parse_client_message
from language_coach.protocol.models import (
    AudioStart,
    AudioStop,
    ServerEvent,
    SessionEnd,
    SessionResume,
    SessionStart,
)
from language_coach.providers.interfaces import MuseStartFailed
from language_coach.services.capabilities import CAPABILITIES
from language_coach.services.session_registry import (
    InvalidSessionState,
    ResumeUnavailable,
    SessionRegistry,
    SessionUnavailable,
)

router = APIRouter()


async def close_socket(websocket: WebSocket, code: int) -> None:
    if websocket.application_state is WebSocketState.DISCONNECTED:
        return
    try:
        await websocket.close(code=code)
    except (RuntimeError, WebSocketDisconnect):
        pass


def origin_is_allowed(origin: str | None, settings: Settings) -> bool:
    if origin is None:
        return True
    if origin == "http://127.0.0.1:8000":
        return settings.allow_insecure_loopback_debug
    return origin in settings.allowed_origins


def _languages_supported(message: SessionStart) -> bool:
    configured = {
        message.config.learning_language,
        message.config.learner1_native_language,
    }
    if message.config.learner2_native_language is not None:
        configured.add(message.config.learner2_native_language)
    return configured <= CAPABILITIES.keys()


@router.websocket("/v1/session")
async def session_socket(websocket: WebSocket) -> None:
    settings: Settings = websocket.app.state.settings
    registry: SessionRegistry = websocket.app.state.registry
    if not origin_is_allowed(websocket.headers.get("origin"), settings):
        await close_socket(websocket, code=4403)
        return
    await websocket.accept()
    attachment_id = uuid4()
    session_id: UUID | None = None
    ended = False
    audio_started = False

    async def sender(event: ServerEvent) -> None:
        await websocket.send_text(encode_server_event(event))

    try:
        async with asyncio.timeout(5):
            first_frame = await websocket.receive()
        first_text = first_frame.get("text")
        if not isinstance(first_text, str):
            await close_socket(websocket, code=4400)
            return
        first = parse_client_message(first_text)
        if not isinstance(first, (SessionStart, SessionResume)):
            await close_socket(websocket, code=4400)
            return
        if not websocket.app.state.pairing_token.verify(first.pairing_token):
            await close_socket(websocket, code=4401)
            return
        if isinstance(first, SessionStart):
            if not settings.providers_configured or not _languages_supported(first):
                await close_socket(websocket, code=4403)
                return
            created = await registry.create(first.config, attachment_id, sender)
            session_id = created.session_id
        else:
            session_id = first.session_id
            try:
                await registry.resume(
                    first.session_id,
                    attachment_id,
                    first.resume_token,
                    first.last_sequence,
                    sender,
                )
            except ResumeUnavailable:
                await close_socket(websocket, code=4404)
                return

        while True:
            frame = await websocket.receive()
            if frame["type"] == "websocket.disconnect":
                break
            binary = frame.get("bytes")
            text = frame.get("text")
            if binary is not None:
                if not audio_started or len(binary) != 3_840:
                    await close_socket(websocket, code=4400)
                    return
                await registry.accept_audio(session_id, attachment_id, binary)
                continue
            if not isinstance(text, str):
                await close_socket(websocket, code=4400)
                return
            message = parse_client_message(text)
            if isinstance(message, (SessionStart, SessionResume)):
                await close_socket(websocket, code=4400)
                return
            if isinstance(message, AudioStart):
                if audio_started:
                    await close_socket(websocket, code=4400)
                    return
                try:
                    await registry.start_audio(session_id, attachment_id)
                except MuseStartFailed:
                    await close_socket(websocket, code=4410)
                    return
                audio_started = True
            elif isinstance(message, AudioStop):
                audio_started = False
                await registry.stop_audio(session_id, attachment_id)
            elif isinstance(message, SessionEnd):
                await registry.close(session_id, "user_end", attachment_id=attachment_id)
                ended = True
                await close_socket(websocket, code=1000)
                return
            else:
                await registry.control(session_id, attachment_id, message)
    except TimeoutError:
        await close_socket(websocket, code=4408)
    except (ValidationError, ValueError, InvalidSessionState, SessionUnavailable):
        await close_socket(websocket, code=4400)
    except WebSocketDisconnect:
        pass
    finally:
        if session_id is not None and not ended:
            await registry.disconnect(session_id, attachment_id)
