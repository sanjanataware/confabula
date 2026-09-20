import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from language_coach.protocol.models import (
    ClientMessageAdapter,
    ServerEventAdapter,
    SessionStart,
)

FIXTURES = Path(__file__).parents[4] / "packages" / "protocol" / "fixtures"


@pytest.mark.parametrize("state", ["idle", "connecting", "active", "degraded", "ended"])
def test_every_connection_state_has_a_strict_wire_shape(state: str) -> None:
    envelope = {
        "type": "session.status", "protocol_version": 1,
        "session_id": "00000000-0000-4000-8000-000000000001",
        "sequence": 0, "connection_state": state, "activities": [],
    }
    assert ServerEventAdapter.validate_python(envelope).connection_state == state
    with pytest.raises(ValidationError):
        ServerEventAdapter.validate_python({**envelope, "connection_state": "unknown"})
    with pytest.raises(ValidationError):
        ServerEventAdapter.validate_python({**envelope, "full_transcript": "private"})


def test_server_discriminators_and_version_cannot_be_omitted() -> None:
    payload = json.loads((FIXTURES / "valid-intervention.json").read_text())
    assert ServerEventAdapter.validate_python(payload).type == "intervention.committed"
    for field in ("type", "protocol_version", "target_text", "intervention_id"):
        malformed = {key: value for key, value in payload.items() if key != field}
        with pytest.raises(ValidationError):
            ServerEventAdapter.validate_python(malformed)


def test_device_speech_ready_requires_explicit_playback_kind() -> None:
    payload = {
        "type": "intervention.audio_ready",
        "protocol_version": 1,
        "session_id": "00000000-0000-4000-8000-000000000001",
        "sequence": 4,
        "turn_id": "turn-a",
        "intervention_id": "00000000-0000-4000-8000-000000000002",
        "playback_kind": "device_speech",
        "audio_url": None,
    }
    assert ServerEventAdapter.validate_python(payload).playback_kind == "device_speech"
    with pytest.raises(ValidationError):
        ServerEventAdapter.validate_python(
            {key: value for key, value in payload.items() if key != "playback_kind"}
        )


def test_valid_session_start_fixture_parses() -> None:
    payload = json.loads((FIXTURES / "valid-session-start.json").read_text())
    message = ClientMessageAdapter.validate_python(payload)
    assert isinstance(message, SessionStart)
    assert message.config.mode == "learner_fluent"


def test_native_language_cannot_equal_learning_language() -> None:
    payload = {
        "type": "session.start",
        "protocol_version": 1,
        "pairing_token": "p" * 43,
        "config": {
            "mode": "learner_fluent",
            "learning_language": "es",
            "learner1_native_language": "es",
            "learner2_native_language": None,
        },
    }
    with pytest.raises(ValidationError):
        ClientMessageAdapter.validate_python(payload)


def test_two_learner_mode_requires_second_native_language() -> None:
    payload = {
        "type": "session.start",
        "protocol_version": 1,
        "pairing_token": "p" * 43,
        "config": {
            "mode": "two_learners",
            "learning_language": "es",
            "learner1_native_language": "en",
            "learner2_native_language": None,
        },
    }
    with pytest.raises(ValidationError):
        ClientMessageAdapter.validate_python(payload)
