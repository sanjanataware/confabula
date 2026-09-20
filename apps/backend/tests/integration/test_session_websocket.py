from dataclasses import replace

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from language_coach.composition import AppDependencies
from language_coach.config import Settings
from language_coach.main import create_app
from language_coach.providers.interfaces import MuseStartFailed
from language_coach.services.audio_assets import InMemoryAudioStore
from language_coach.services.pairing import PairingToken
from tests.fakes.clock import ManualClock
from tests.fakes.providers import FakeAnalyzer, FakeSynthesizer, FakeTranscriber

PAIRING_TOKEN = "p" * 43


def dependencies() -> tuple[AppDependencies, FakeTranscriber]:
    transcriber = FakeTranscriber()
    return (
        AppDependencies(
            settings=Settings(
                _env_file=None,
                muse_api_key="muse",
                labs_api_key="labs",
                labs_voice_id="voice",
                allowed_origins=["https://testserver"],
                backend_public_base_url="https://localhost:8444",
            ),
            pairing_token=PairingToken(PAIRING_TOKEN),
            transcriber=transcriber,
            analyzer=FakeAnalyzer(),
            synthesizer=FakeSynthesizer(),
            audio_store=InMemoryAudioStore(),
            clock=ManualClock(),
        ),
        transcriber,
    )


def start_message(token: str = PAIRING_TOKEN) -> dict[str, object]:
    return {
        "type": "session.start",
        "protocol_version": 1,
        "pairing_token": token,
        "config": {
            "mode": "learner_fluent",
            "learning_language": "es",
            "learner1_native_language": "en",
            "learner2_native_language": None,
        },
    }


def test_session_starts_provider_only_after_audio_start() -> None:
    deps, transcriber = dependencies()
    with (
        TestClient(create_app(deps)) as client,
        client.websocket_connect("/v1/session") as socket,
    ):
        socket.send_json(start_message())
        ready = socket.receive_json()
        idle = socket.receive_json()
        assert ready["type"] == "session.ready"
        assert idle["connection_state"] == "idle"
        assert transcriber.sessions == []

        socket.send_json({"type": "audio.start", "protocol_version": 1})
        assert socket.receive_json()["connection_state"] == "connecting"
        assert socket.receive_json()["connection_state"] == "active"
        socket.send_bytes(bytes(3840))
        assert len(transcriber.sessions) == 1

        socket.send_json({"type": "session.end", "protocol_version": 1})
        assert socket.receive_json()["type"] == "session.ended"


def test_wrong_pairing_token_is_rejected() -> None:
    deps, transcriber = dependencies()
    with (
        TestClient(create_app(deps)) as client,
        client.websocket_connect("/v1/session") as socket,
    ):
        socket.send_json(start_message("x" * 43))
        with pytest.raises(WebSocketDisconnect) as error:
            socket.receive_json()
        assert error.value.code == 4401
    assert transcriber.sessions == []


@pytest.mark.parametrize(("origin", "debug", "allowed"), [
    (None, False, True), ("https://testserver", False, True),
    ("https://unknown.test", False, False),
    ("http://127.0.0.1:8000", True, True),
    ("http://127.0.0.1:8000", False, False),
    ("http://192.168.1.8:8000", True, False),
    ("http://127.0.0.1.evil.test:8000", True, False),
])
def test_websocket_origin_allowlist(origin: str | None, debug: bool, allowed: bool) -> None:
    deps, _ = dependencies()
    config = deps.settings.model_copy(update={"allow_insecure_loopback_debug": debug})
    headers = {"Origin": origin} if origin is not None else {}
    with TestClient(create_app(replace(deps, settings=config))) as client:
        if allowed:
            with client.websocket_connect("/v1/session", headers=headers) as socket:
                socket.send_json(start_message())
                assert socket.receive_json()["type"] == "session.ready"
        else:
            with (
                pytest.raises(WebSocketDisconnect),
                client.websocket_connect("/v1/session", headers=headers),
            ):
                pass


def test_muse_handshake_failure_flushes_safe_events_and_removes_entry() -> None:
    deps, transcriber = dependencies()
    transcriber.error = MuseStartFailed("private-provider-message")
    app = create_app(deps)
    with TestClient(app) as client, client.websocket_connect("/v1/session") as socket:
        socket.send_json(start_message())
        socket.receive_json()
        socket.receive_json()
        socket.send_json({"type": "audio.start", "protocol_version": 1})
        assert socket.receive_json()["connection_state"] == "connecting"
        degraded = socket.receive_json()
        assert degraded["code"] == "muse_start_failed"
        assert "private-provider-message" not in str(degraded)
        assert socket.receive_json()["reason"] == "muse_failure"
        with pytest.raises(WebSocketDisconnect) as error:
            socket.receive_json()
        assert error.value.code == 4410
        assert app.state.registry.active_count == 0


@pytest.mark.parametrize("payload", [
    {"type": "audio.start", "protocol_version": 1},
    {"type": "session.start", "protocol_version": 2},
    {"type": "unknown", "protocol_version": 1},
])
def test_invalid_first_control_never_opens_a_provider(payload: dict[str, object]) -> None:
    deps, transcriber = dependencies()
    with TestClient(create_app(deps)) as client, client.websocket_connect("/v1/session") as socket:
        socket.send_json(payload)
        with pytest.raises(WebSocketDisconnect) as error:
            socket.receive_json()
        assert error.value.code == 4400
    assert not transcriber.sessions


def test_audio_before_active_acknowledgement_is_rejected() -> None:
    deps, transcriber = dependencies()
    with TestClient(create_app(deps)) as client, client.websocket_connect("/v1/session") as socket:
        socket.send_json(start_message())
        socket.receive_json()
        socket.receive_json()
        socket.send_bytes(bytes(3840))
        with pytest.raises(WebSocketDisconnect) as error:
            socket.receive_json()
        assert error.value.code == 4400
    assert not transcriber.sessions


def test_cors_allows_only_configured_origins() -> None:
    deps, _ = dependencies()
    with TestClient(create_app(deps)) as client:
        allowed = client.get("/health", headers={"Origin": "https://testserver"})
        denied = client.get("/health", headers={"Origin": "https://unknown.test"})
        assert allowed.headers["access-control-allow-origin"] == "https://testserver"
        assert "access-control-allow-origin" not in denied.headers
