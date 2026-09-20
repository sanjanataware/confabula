import secrets
from dataclasses import dataclass
from uuid import UUID

from language_coach.providers.interfaces import AudioAsset


class AudioAssetNotFound(LookupError):
    pass


@dataclass(frozen=True)
class StoredAudioAsset:
    content_type: str
    data: bytes
    intervention_id: UUID | None


class InMemoryAudioStore:
    def __init__(self) -> None:
        self._sessions: dict[UUID, dict[str, StoredAudioAsset]] = {}

    @property
    def size_bytes(self) -> int:
        return sum(
            len(asset.data)
            for assets in self._sessions.values()
            for asset in assets.values()
        )

    @property
    def count(self) -> int:
        return sum(len(assets) for assets in self._sessions.values())

    def put(
        self,
        session_id: UUID,
        audio: AudioAsset,
        intervention_id: UUID | None = None,
    ) -> str:
        asset_id = secrets.token_urlsafe(24)
        self._sessions.setdefault(session_id, {})[asset_id] = StoredAudioAsset(
            content_type=audio.content_type,
            data=bytes(audio.data),
            intervention_id=intervention_id,
        )
        return asset_id

    def get(self, session_id: UUID, asset_id: str) -> StoredAudioAsset:
        try:
            return self._sessions[session_id][asset_id]
        except KeyError as error:
            raise AudioAssetNotFound("audio asset not found") from error

    def clear_session(self, session_id: UUID) -> None:
        self._sessions.pop(session_id, None)

    def session_size_bytes(self, session_id: UUID) -> int:
        return sum(
            len(asset.data) for asset in self._sessions.get(session_id, {}).values()
        )
