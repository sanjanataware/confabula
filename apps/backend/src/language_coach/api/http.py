from uuid import UUID

from fastapi import APIRouter, HTTPException, Request
from starlette.responses import StreamingResponse

from language_coach.config import Settings
from language_coach.services.audio_assets import AudioAssetNotFound
from language_coach.services.capabilities import CAPABILITIES
from language_coach.services.session_registry import SessionRegistry, SessionUnavailable

router = APIRouter()


@router.get("/health")
async def health(request: Request) -> dict[str, object]:
    settings: Settings = request.app.state.settings
    return settings.safe_health_payload()


@router.get("/v1/capabilities")
async def capabilities() -> dict[str, object]:
    return {
        "protocol_version": 1,
        "languages": [
            {
                "code": capability.code,
                "display_name": capability.display_name,
                "muse_bias_name": capability.muse_bias_name,
                "speech_route": {"kind": "device_speech"},
            }
            for capability in CAPABILITIES.values()
        ],
    }


@router.get("/v1/sessions/{session_id}/audio/{asset_id}")
async def session_audio(
    request: Request,
    session_id: UUID,
    asset_id: str,
) -> StreamingResponse:
    registry: SessionRegistry = request.app.state.registry
    try:
        registry.get_entry(session_id)
        asset = registry.dependencies.audio_store.get(session_id, asset_id)
    except (SessionUnavailable, AudioAssetNotFound):
        raise HTTPException(status_code=404, detail="audio asset not found") from None
    return StreamingResponse(
        iter([asset.data]),
        media_type=asset.content_type,
        headers={
            "Cache-Control": "no-store, max-age=0",
            "X-Content-Type-Options": "nosniff",
        },
    )
