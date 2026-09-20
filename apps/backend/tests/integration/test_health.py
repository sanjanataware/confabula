from fastapi.testclient import TestClient

from language_coach.composition import AppDependencies
from language_coach.config import Settings
from language_coach.main import create_app
from language_coach.providers.kokoro import KOKORO_ROUTES
from language_coach.services.audio_assets import InMemoryAudioStore
from language_coach.services.pairing import PairingToken
from tests.fakes.clock import ManualClock
from tests.fakes.providers import FakeAnalyzer, FakeSynthesizer, FakeTranscriber


def settings(**overrides: object) -> Settings:
    values: dict[str, object] = {
        "muse_api_key": "fixture-muse-key",
        "allowed_origins": ["https://localhost:8443"],
        "backend_public_base_url": "https://localhost:8444",
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)


def dependencies(config: Settings) -> AppDependencies:
    return AppDependencies(
        settings=config,
        pairing_token=PairingToken("p" * 43),
        transcriber=FakeTranscriber(),
        analyzer=FakeAnalyzer(),
        synthesizer=FakeSynthesizer(),
        audio_store=InMemoryAudioStore(),
        clock=ManualClock(),
    )


def test_health_reports_ready_providers_without_secrets() -> None:
    app = create_app(dependencies(settings()))
    with TestClient(app) as client:
        response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "protocol_version": 1,
        "providers": {"meta": True, "device_speech": True},
    }
    assert "fixture" not in response.text


def test_health_reports_missing_provider_configuration() -> None:
    app = create_app(
        dependencies(settings(muse_api_key=None))
    )
    with TestClient(app) as client:
        response = client.get("/health")

    assert response.json()["status"] == "not_ready"
    assert response.json()["providers"] == {"meta": False, "device_speech": True}


def test_capabilities_lists_every_supported_language() -> None:
    app = create_app(dependencies(settings()))
    with TestClient(app) as client:
        response = client.get("/v1/capabilities")

    assert response.status_code == 200
    assert len(response.json()["languages"]) == 25
    assert {item["code"] for item in response.json()["languages"]} >= {"en", "es", "bn"}
    routes = {item["code"]: item["speech_route"] for item in response.json()["languages"]}
    assert all(
        routes[code] == {"kind": "local_neural", "fallback": "device_speech"}
        for code in KOKORO_ROUTES
    )
    assert routes["bn"] == {"kind": "device_speech"}
