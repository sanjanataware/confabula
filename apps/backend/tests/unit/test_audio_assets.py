from uuid import uuid4

import pytest

from language_coach.providers.interfaces import AudioAsset
from language_coach.services.audio_assets import AudioAssetNotFound, InMemoryAudioStore


def test_assets_are_session_scoped_and_cleared() -> None:
    store = InMemoryAudioStore()
    first_session = uuid4()
    second_session = uuid4()
    asset_id = store.put(first_session, AudioAsset("audio/mpeg", b"audio"))
    assert len(asset_id) >= 32
    assert store.get(first_session, asset_id).data == b"audio"
    with pytest.raises(AudioAssetNotFound):
        store.get(second_session, asset_id)
    assert store.size_bytes == 5
    store.clear_session(first_session)
    assert store.size_bytes == 0
    with pytest.raises(AudioAssetNotFound):
        store.get(first_session, asset_id)
