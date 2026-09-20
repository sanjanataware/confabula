from language_coach.providers.interfaces import AudioAsset, SpeechRequest
from language_coach.services.capabilities import get_capability

DEVICE_SPEECH_CONTENT_TYPE = "application/vnd.language-coach.device-speech"


class DeviceSpeechSynthesizer:
    async def synthesize(self, request: SpeechRequest) -> AudioAsset:
        get_capability(request.target_language_code)
        return AudioAsset(content_type=DEVICE_SPEECH_CONTENT_TYPE, data=b"")
