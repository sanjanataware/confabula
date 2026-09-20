import logging
from uuid import UUID

from fastapi.testclient import TestClient

from language_coach.main import create_app
from language_coach.providers.interfaces import AudioAsset
from language_coach.services.safe_logging import log_event
from tests.integration.test_session_websocket import dependencies, start_message


def test_logs_contain_only_metadata_not_content_credentials_or_asset_paths(caplog) -> None:
    deps, _ = dependencies()
    with caplog.at_level(logging.INFO), TestClient(create_app(deps)) as client:
        log_event(logging.getLogger("language_coach.test"), logging.INFO, "safe_test", {
            "duration_ms": 10,
            "transcript": "private-transcript",
            "audio": b"private-audio-sentinel",
            "api_key": "private-key-sentinel",
        })
        with client.websocket_connect("/v1/session") as socket:
            socket.send_json(start_message())
            ready = socket.receive_json()
            socket.receive_json()
            session_id = UUID(ready["session_id"])
            asset_id = deps.audio_store.put(session_id, AudioAsset("audio/mpeg", b"private-audio-sentinel"))
            response = client.get(f"/v1/sessions/{session_id}/audio/{asset_id}")
            assert response.status_code == 200
            socket.send_json({"type": "session.end", "protocol_version": 1})
            socket.receive_json()
    rendered = caplog.text + repr([getattr(record, "safe_metadata", {}) for record in caplog.records])
    for forbidden in (
        "private-transcript", "private-audio-sentinel", "private-key-sentinel",
        ready["resume_token"], deps.pairing_token.value, asset_id,
    ):
        assert forbidden not in rendered
    assert "http.session_audio" in rendered


def test_production_routes_never_expose_test_controls() -> None:
    deps, _ = dependencies()
    with TestClient(create_app(deps)) as client:
        assert client.get("/__e2e__/state").status_code == 404
        assert client.post("/__e2e__/control/finalize").status_code == 404
