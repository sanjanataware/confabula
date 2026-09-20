import pytest
from pydantic import ValidationError

from language_coach.config import Settings


def values(**overrides: object) -> dict[str, object]:
    result: dict[str, object] = {
        "muse_api_key": "muse",
        "allowed_origins": ["https://localhost:8443"],
        "backend_public_base_url": "https://localhost:8444",
    }
    result.update(overrides)
    return result


def test_https_public_origin_is_preserved() -> None:
    settings = Settings(_env_file=None, **values())
    assert settings.backend_public_base_url == "https://localhost:8444"


def test_loopback_http_requires_explicit_debug_flag() -> None:
    with pytest.raises(ValidationError):
        Settings(
            _env_file=None,
            **values(backend_public_base_url="http://127.0.0.1:8000"),
        )
    settings = Settings(
        _env_file=None,
        **values(
            backend_public_base_url="http://127.0.0.1:8000",
            allow_insecure_loopback_debug=True,
        ),
    )
    assert settings.backend_public_base_url.startswith("http://127.0.0.1")


def test_only_the_meta_environment_key_configures_provider_readiness(monkeypatch) -> None:
    monkeypatch.setenv("MUSE_API_KEY", "fixture-meta-secret")
    monkeypatch.setenv("LABS_API_KEY", "ignored-labs-secret")
    settings = Settings(
        _env_file=None,
        allowed_origins=["https://localhost:8443"],
        backend_public_base_url="https://localhost:8444",
    )
    assert settings.muse_api_key.get_secret_value() == "fixture-meta-secret"
    assert settings.providers_configured
    assert settings.provider_readiness == {"meta": True, "device_speech": True}
    assert "fixture-meta-secret" not in repr(settings)
    assert "fixture-meta-secret" not in settings.model_dump_json()
    assert not hasattr(settings, "labs_api_key")
    monkeypatch.delenv("MUSE_API_KEY")
    missing = Settings(
        _env_file=None,
        allowed_origins=["https://localhost:8443"],
        backend_public_base_url="https://localhost:8444",
    )
    assert not missing.providers_configured


@pytest.mark.parametrize(
    "url",
    [
        "http://192.168.1.3:8000",
        "https://user:pass@localhost:8444",
        "https://localhost:8444/path",
        "https://localhost:8444?token=x",
        "https://localhost:8444#fragment",
    ],
)
def test_unsafe_public_origins_are_rejected(url: str) -> None:
    with pytest.raises(ValidationError):
        Settings(
            _env_file=None,
            **values(
                backend_public_base_url=url,
                allow_insecure_loopback_debug=True,
            ),
        )
