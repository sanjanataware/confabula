from uuid import UUID, uuid4

from fastapi.testclient import TestClient

from language_coach.main import create_app
from language_coach.providers.interfaces import AudioAsset
from tests.integration.test_session_websocket import (
    PAIRING_TOKEN,
    dependencies,
    start_message,
)


def test_audio_asset_is_session_scoped_and_no_store() -> None:
    deps, _ = dependencies()
    with TestClient(create_app(deps)) as client:
        with client.websocket_connect("/v1/session") as socket:
            socket.send_json(start_message(PAIRING_TOKEN))
            ready = socket.receive_json()
            socket.receive_json()
            session_id = UUID(ready["session_id"])
            asset_id = deps.audio_store.put(
                session_id,
                AudioAsset("audio/mpeg", b"fixture-audio"),
            )
            response = client.get(
                f"/v1/sessions/{session_id}/audio/{asset_id}"
            )
            assert response.status_code == 200
            assert response.content == b"fixture-audio"
            assert response.headers["cache-control"] == "no-store, max-age=0"
            assert (
                client.get(
                    f"/v1/sessions/{uuid4()}/audio/{asset_id}"
                ).status_code
                == 404
            )
            socket.send_json({"type": "session.end", "protocol_version": 1})
            socket.receive_json()
        assert (
            client.get(f"/v1/sessions/{session_id}/audio/{asset_id}").status_code
            == 404
        )
