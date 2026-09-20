from types import SimpleNamespace

import pytest
from elevenlabs.core.api_error import ApiError

from language_coach.providers.elevenlabs import (
    ElevenLabsSynthesizer,
    SpeechRequest,
    SpeechSynthesisUnavailable,
)


class FakeEndpoint:
    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []

    def convert(self, **kwargs: object) -> list[bytes]:
        self.calls.append(kwargs)
        return [b"first", b"second"]


@pytest.mark.asyncio
async def test_spanish_uses_flash_route() -> None:
    tts = FakeEndpoint()
    dialogue = FakeEndpoint()
    client = SimpleNamespace(text_to_speech=tts, text_to_dialogue=dialogue)
    asset = await ElevenLabsSynthesizer(client, "voice").synthesize(
        SpeechRequest("supermercado", "es")
    )
    assert asset.data == b"firstsecond"
    assert tts.calls[0]["model_id"] == "eleven_flash_v2_5"
    assert tts.calls[0]["output_format"] == "mp3_44100_128"
    assert dialogue.calls == []


@pytest.mark.asyncio
async def test_bengali_uses_dialogue_route() -> None:
    tts = FakeEndpoint()
    dialogue = FakeEndpoint()
    client = SimpleNamespace(text_to_speech=tts, text_to_dialogue=dialogue)
    await ElevenLabsSynthesizer(client, "voice").synthesize(
        SpeechRequest("বাজার", "bn")
    )
    assert dialogue.calls[0]["model_id"] == "eleven_v3_conversational"
    assert dialogue.calls[0]["output_format"] == "mp3_44100_128"
    assert dialogue.calls[0]["request_options"] == {"max_retries": 0, "timeout_in_seconds": 5}
    assert tts.calls == []


@pytest.mark.asyncio
@pytest.mark.parametrize("status", [401, 402, 429, 500])
async def test_provider_errors_are_safe_and_unsupported_languages_do_not_call_provider(status: int) -> None:
    class BrokenEndpoint(FakeEndpoint):
        def convert(self, **kwargs: object) -> list[bytes]:
            self.calls.append(kwargs)
            raise ApiError(status_code=status, body="private-text-and-key")

    endpoint = BrokenEndpoint()
    client = SimpleNamespace(text_to_speech=endpoint, text_to_dialogue=endpoint)
    synth = ElevenLabsSynthesizer(client, "voice")
    with pytest.raises(SpeechSynthesisUnavailable) as error:
        await synth.synthesize(SpeechRequest("private-text", "es"))
    assert "private-text" not in str(error.value)
    with pytest.raises(SpeechSynthesisUnavailable):
        await synth.synthesize(SpeechRequest("private-text", "unsupported"))
    assert len(endpoint.calls) == 1
