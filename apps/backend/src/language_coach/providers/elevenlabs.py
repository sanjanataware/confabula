import asyncio
from typing import Any

import httpx
from elevenlabs.core.api_error import ApiError

from language_coach.providers.interfaces import (
    AudioAsset,
    SpeechRequest,
    SpeechSynthesisUnavailable,
)
from language_coach.services.capabilities import (
    UnsupportedLanguageError,
    get_capability,
)


class ElevenLabsSynthesizer:
    def __init__(self, client: Any, voice_id: str) -> None:
        self._client = client
        self._voice_id = voice_id

    async def synthesize(self, request: SpeechRequest) -> AudioAsset:
        try:
            rendered = await asyncio.to_thread(self._render, request)
        except (UnsupportedLanguageError, ApiError, httpx.HTTPError, OSError, RuntimeError):
            raise SpeechSynthesisUnavailable(
                "ElevenLabs speech generation unavailable"
            ) from None
        if not rendered:
            raise SpeechSynthesisUnavailable("ElevenLabs returned empty audio")
        return AudioAsset(content_type="audio/mpeg", data=rendered)

    def _render(self, request: SpeechRequest) -> bytes:
        capability = get_capability(request.target_language_code)
        route = capability.tts_route
        if route.kind == "flash":
            chunks = self._client.text_to_speech.convert(
                voice_id=self._voice_id,
                text=request.target_text,
                model_id=route.model_id,
                output_format=route.output_format,
                language_code=capability.eleven_language_code,
                request_options={"max_retries": 0, "timeout_in_seconds": 5},
            )
        else:
            chunks = self._client.text_to_dialogue.convert(
                inputs=[{"text": request.target_text, "voice_id": self._voice_id}],
                model_id=route.model_id,
                output_format=route.output_format,
                language_code=capability.eleven_language_code,
                request_options={"max_retries": 0, "timeout_in_seconds": 5},
            )
        return b"".join(chunks)


__all__ = [
    "AudioAsset",
    "ElevenLabsSynthesizer",
    "SpeechRequest",
    "SpeechSynthesisUnavailable",
]
