import os

import pytest
from elevenlabs.client import ElevenLabs

from language_coach.providers.elevenlabs import ElevenLabsSynthesizer, SpeechRequest

pytestmark = pytest.mark.live_provider


@pytest.mark.asyncio
async def test_flash_and_dialogue_routes_live() -> None:
    missing = [
        name for name in ("LABS_API_KEY", "LABS_VOICE_ID") if not os.getenv(name)
    ]
    if missing:
        pytest.fail(f"Missing required variables: {', '.join(missing)}")
    client = ElevenLabs(api_key=os.environ["LABS_API_KEY"], timeout=5)
    synthesizer = ElevenLabsSynthesizer(client, os.environ["LABS_VOICE_ID"])
    spanish = await synthesizer.synthesize(SpeechRequest("supermercado", "es"))
    bengali = await synthesizer.synthesize(SpeechRequest("বাজার", "bn"))
    assert spanish.content_type == "audio/mpeg" and spanish.data
    assert bengali.content_type == "audio/mpeg" and bengali.data
