import asyncio
import os
from pathlib import Path
from uuid import uuid4

import pytest

from language_coach.domain.models import SpeechCompleted, TranscriptPartial
from language_coach.providers.interfaces import TranscriptionConfig
from language_coach.providers.muse_transcribe import MuseTranscriber

pytestmark = pytest.mark.live_provider


@pytest.mark.asyncio
async def test_muse_transcription_live() -> None:
    missing = [
        name
        for name in ("MUSE_API_KEY", "LIVE_MUSE_PCM_PATH")
        if not os.getenv(name)
    ]
    if missing:
        pytest.fail(f"Missing required variables: {', '.join(missing)}")
    key = os.environ["MUSE_API_KEY"]
    audio = Path(os.environ["LIVE_MUSE_PCM_PATH"]).read_bytes()
    if not audio or len(audio) % 3840:
        pytest.fail("LIVE_MUSE_PCM_PATH must contain complete 3,840-byte PCM frames")
    session = await MuseTranscriber(key).open(
        TranscriptionConfig(uuid4(), ("English", "Spanish"))
    )
    for offset in range(0, len(audio), 3840):
        await session.send_pcm(audio[offset : offset + 3840])
        await asyncio.sleep(0.08)
    observed = []
    try:
        async with asyncio.timeout(15):
            async for event in session.events():
                observed.append(event)
                if isinstance(event, SpeechCompleted):
                    break
    finally:
        await session.close()
    assert any(isinstance(event, TranscriptPartial) for event in observed)
    assert any(isinstance(event, SpeechCompleted) for event in observed)
