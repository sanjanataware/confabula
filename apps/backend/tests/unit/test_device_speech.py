import pytest

from language_coach.providers.device_speech import (
    DEVICE_SPEECH_CONTENT_TYPE,
    DeviceSpeechSynthesizer,
)
from language_coach.providers.interfaces import SpeechRequest
from language_coach.services.capabilities import UnsupportedLanguageError


@pytest.mark.asyncio
async def test_device_speech_plan_contains_no_audio_bytes() -> None:
    asset = await DeviceSpeechSynthesizer().synthesize(
        SpeechRequest(target_text="supermercado", target_language_code="es")
    )
    assert asset.content_type == DEVICE_SPEECH_CONTENT_TYPE
    assert asset.data == b""


@pytest.mark.asyncio
async def test_device_speech_rejects_unknown_languages() -> None:
    with pytest.raises(UnsupportedLanguageError):
        await DeviceSpeechSynthesizer().synthesize(
            SpeechRequest(target_text="text", target_language_code="unknown")
        )
