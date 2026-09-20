from typing import Any
from urllib.parse import urlsplit

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

LOOPBACK_HOSTS = {"localhost", "127.0.0.1", "::1"}


def validate_origin(value: str) -> None:
    parsed = urlsplit(value)
    if (
        parsed.scheme not in {"http", "https"} or not parsed.hostname
        or "*" in value or parsed.username is not None or parsed.password is not None
        or parsed.path not in {"", "/"} or parsed.query or parsed.fragment
        or (parsed.port is not None and parsed.port < 1)
    ):
        raise ValueError("address must be an explicit HTTP(S) origin")
    if parsed.scheme == "http" and parsed.hostname not in LOOPBACK_HOSTS:
        raise ValueError("insecure origins must use loopback")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore",
        hide_input_in_errors=True,
    )

    muse_api_key: SecretStr | None = Field(default=None, repr=False)
    allowed_origins: list[str] = Field(default_factory=lambda: [
        "http://localhost:8081", "https://localhost:8443",
    ])
    backend_public_base_url: str = "https://localhost:8444"
    client_public_base_url: str = "https://localhost:8443"
    allow_insecure_loopback_debug: bool = False

    @field_validator("muse_api_key", mode="before")
    @classmethod
    def blank_to_missing(cls, value: Any) -> Any:
        return value.strip() or None if isinstance(value, str) else value

    @model_validator(mode="after")
    def validate_urls(self) -> "Settings":
        if not self.allowed_origins:
            raise ValueError("allowed origins must be explicit")
        for origin in self.allowed_origins:
            validate_origin(origin)
        validate_origin(self.backend_public_base_url)
        validate_origin(self.client_public_base_url)
        if urlsplit(self.backend_public_base_url).scheme == "http" and not self.allow_insecure_loopback_debug:
            raise ValueError("backend public base URL must use HTTPS")
        self.allowed_origins = [origin.rstrip("/") for origin in self.allowed_origins]
        self.backend_public_base_url = self.backend_public_base_url.rstrip("/")
        self.client_public_base_url = self.client_public_base_url.rstrip("/")
        return self

    @property
    def provider_readiness(self) -> dict[str, bool]:
        return {
            "meta": bool(self.muse_api_key),
            "device_speech": True,
        }

    @property
    def providers_configured(self) -> bool:
        return all(self.provider_readiness.values())

    def safe_health_payload(self) -> dict[str, Any]:
        return {
            "status": "ok" if self.providers_configured else "not_ready",
            "protocol_version": 1,
            "providers": self.provider_readiness,
        }
