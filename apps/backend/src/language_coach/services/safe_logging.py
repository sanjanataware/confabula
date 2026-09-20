import logging
from collections.abc import Mapping
from typing import Any

_ALLOWED_FIELDS = {
    "event_type",
    "session_id",
    "turn_id",
    "intervention_id",
    "duration_ms",
    "completed",
    "status_code",
    "provider_request_id",
    "exception_class",
    "stage",
    "speculative_reused",
}


def configure_safe_logging() -> None:
    logging.getLogger("language_coach").setLevel(logging.INFO)
    for name in ("httpx", "httpx2", "httpcore", "httpcore2", "openai", "elevenlabs", "uvicorn.access"):
        logger = logging.getLogger(name)
        logger.setLevel(logging.CRITICAL + 1)
        logger.disabled = True


def safe_metadata(**values: Any) -> dict[str, Any]:
    return {key: value for key, value in values.items() if key in _ALLOWED_FIELDS}


def log_event(
    logger: logging.Logger,
    level: int,
    event_type: str,
    metadata: Mapping[str, Any] | None = None,
) -> None:
    fields = safe_metadata(event_type=event_type, **dict(metadata or {}))
    logger.log(level, "%s %s", event_type, fields, extra={"safe_metadata": fields})
