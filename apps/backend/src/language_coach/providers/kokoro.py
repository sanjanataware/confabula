import asyncio
import importlib
import io
import logging
import os
import warnings
from collections.abc import Callable
from typing import Any

import numpy as np

from language_coach.providers.interfaces import (
    AudioAsset,
    SpeechRequest,
    SpeechSynthesisUnavailable,
    SpeechSynthesizer,
)

os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
logging.getLogger("huggingface_hub").setLevel(logging.ERROR)
warnings.filterwarnings("ignore", message="dropout option adds dropout.*")
warnings.filterwarnings("ignore", message=".*weight_norm.*deprecated.*")
warnings.filterwarnings("ignore", message=".*torch.jit.script.*deprecated.*")

KOKORO_ROUTES: dict[str, tuple[str, str]] = {
    "en": ("a", "af_heart"),
    "es": ("e", "ef_dora"),
    "fr": ("f", "ff_siwis"),
    "hi": ("h", "hf_alpha"),
    "it": ("i", "if_sara"),
    "ja": ("j", "jf_alpha"),
    "pt": ("p", "pf_dora"),
    "zh": ("z", "zf_xiaobei"),
}


class KokoroSpeechSynthesizer:
    def __init__(
        self,
        pipeline_factory: Callable[..., Any] | None = None,
        gain: float = 1.5,
    ) -> None:
        if pipeline_factory is None:
            pipeline_factory = importlib.import_module("kokoro").KPipeline
        self._pipeline_factory = pipeline_factory
        self._gain = gain
        self._model: Any | None = None
        self._pipelines: dict[str, Any] = {}
        self._lock = asyncio.Lock()
        self._disabled = False

    @property
    def supported_languages(self) -> frozenset[str]:
        return frozenset(KOKORO_ROUTES)

    @property
    def available(self) -> bool:
        return not self._disabled

    async def prepare(self) -> None:
        async with self._lock:
            if self._model is not None or self._disabled:
                return
            try:
                await asyncio.to_thread(self._load_base_model)
                await asyncio.to_thread(
                    self._render,
                    SpeechRequest("Hola.", "es"),
                )
            except (OSError, RuntimeError, ValueError, ImportError):
                self._disabled = True

    async def synthesize(self, request: SpeechRequest) -> AudioAsset:
        if request.target_language_code not in KOKORO_ROUTES or self._disabled:
            raise SpeechSynthesisUnavailable("local neural speech is unavailable")
        async with self._lock:
            try:
                data = await asyncio.to_thread(self._render, request)
            except (OSError, RuntimeError, ValueError, ImportError):
                self._disabled = True
                raise SpeechSynthesisUnavailable(
                    "local neural speech is unavailable"
                ) from None
        return AudioAsset(content_type="audio/wav", data=data)

    def _device(self) -> str:
        import torch

        if torch.backends.mps.is_available():
            return "mps"
        if torch.cuda.is_available():
            return "cuda"
        return "cpu"

    def _load_base_model(self) -> None:
        pipeline = self._pipeline_factory(
            lang_code="a",
            repo_id="hexgrad/Kokoro-82M",
            device=self._device(),
        )
        self._model = pipeline.model
        self._pipelines["a"] = pipeline

    def _pipeline(self, language_code: str) -> tuple[Any, str]:
        lang_code, voice = KOKORO_ROUTES[language_code]
        pipeline = self._pipelines.get(lang_code)
        if pipeline is None:
            if self._model is None:
                self._load_base_model()
            pipeline = self._pipeline_factory(
                lang_code=lang_code,
                repo_id="hexgrad/Kokoro-82M",
                model=self._model,
                device=self._device(),
            )
            self._pipelines[lang_code] = pipeline
        return pipeline, voice

    def _render(self, request: SpeechRequest) -> bytes:
        pipeline, voice = self._pipeline(request.target_language_code)
        chunks = [
            np.asarray(result.audio, dtype=np.float32)
            for result in pipeline(request.target_text, voice=voice, speed=1.0)
        ]
        if not chunks:
            raise RuntimeError("local neural speech returned no audio")
        waveform = np.clip(np.concatenate(chunks) * self._gain, -1, 1)
        output = io.BytesIO()
        soundfile = importlib.import_module("soundfile")
        soundfile.write(output, waveform, 24_000, format="WAV", subtype="PCM_16")
        return output.getvalue()


class HybridSpeechSynthesizer:
    def __init__(
        self,
        neural: KokoroSpeechSynthesizer,
        fallback: SpeechSynthesizer,
    ) -> None:
        self.neural = neural
        self.fallback = fallback

    async def prepare(self) -> None:
        await self.neural.prepare()

    async def synthesize(self, request: SpeechRequest) -> AudioAsset:
        if request.target_language_code in self.neural.supported_languages:
            try:
                return await self.neural.synthesize(request)
            except SpeechSynthesisUnavailable:
                pass
        return await self.fallback.synthesize(request)
