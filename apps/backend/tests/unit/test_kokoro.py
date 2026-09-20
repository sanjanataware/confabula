from dataclasses import dataclass
from io import BytesIO

import numpy as np
import pytest
import soundfile as sf

from language_coach.providers.device_speech import (
    DEVICE_SPEECH_CONTENT_TYPE,
    DeviceSpeechSynthesizer,
)
from language_coach.providers.interfaces import (
    SpeechRequest,
    SpeechSynthesisUnavailable,
)
from language_coach.providers.kokoro import (
    HybridSpeechSynthesizer,
    KokoroSpeechSynthesizer,
)


@dataclass
class Result:
    audio: np.ndarray


class FakePipeline:
    def __init__(self, lang_code: str, model: object | None = None, fail: bool = False, **kwargs) -> None:
        self.lang_code = lang_code
        self.model = model or object()
        self.fail = fail

    def __call__(self, text: str, voice: str, speed: float):
        if self.fail:
            raise RuntimeError("fixture failure")
        yield Result(np.full(2400, 0.25, dtype=np.float32))


@pytest.mark.asyncio
async def test_kokoro_renders_wav_with_shared_model_and_language_voice() -> None:
    created: list[FakePipeline] = []

    def factory(**kwargs):
        pipeline = FakePipeline(**kwargs)
        created.append(pipeline)
        return pipeline

    synthesizer = KokoroSpeechSynthesizer(pipeline_factory=factory)
    await synthesizer.prepare()
    asset = await synthesizer.synthesize(SpeechRequest("supermercado", "es"))
    samples, sample_rate = sf.read(BytesIO(asset.data), dtype="float32")
    assert asset.content_type == "audio/wav"
    assert sample_rate == 24_000
    assert len(samples) == 2400
    assert np.max(samples) == pytest.approx(0.375, abs=0.001)
    assert [pipeline.lang_code for pipeline in created] == ["a", "e"]
    assert created[1].model is created[0].model


@pytest.mark.asyncio
async def test_kokoro_rejects_unsupported_language() -> None:
    synthesizer = KokoroSpeechSynthesizer(pipeline_factory=FakePipeline)
    with pytest.raises(SpeechSynthesisUnavailable):
        await synthesizer.synthesize(SpeechRequest("مرحبا", "ar"))


@pytest.mark.asyncio
async def test_hybrid_uses_device_for_unsupported_or_failed_neural_speech() -> None:
    neural = KokoroSpeechSynthesizer(pipeline_factory=lambda **kwargs: FakePipeline(fail=True, **kwargs))
    hybrid = HybridSpeechSynthesizer(neural, DeviceSpeechSynthesizer())
    failed = await hybrid.synthesize(SpeechRequest("supermercado", "es"))
    unsupported = await hybrid.synthesize(SpeechRequest("مرحبا", "ar"))
    assert failed.content_type == DEVICE_SPEECH_CONTENT_TYPE
    assert unsupported.content_type == DEVICE_SPEECH_CONTENT_TYPE
