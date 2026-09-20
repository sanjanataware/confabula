from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from openai import AsyncOpenAI

from language_coach.config import Settings
from language_coach.domain.session_coordinator import Clock, SystemClock
from language_coach.providers.device_speech import DeviceSpeechSynthesizer
from language_coach.providers.interfaces import (
    SparkAnalyzer,
    SpeechSynthesizer,
    Transcriber,
)
from language_coach.providers.muse_spark import MuseSparkAnalyzer
from language_coach.providers.muse_transcribe import MuseTranscriber
from language_coach.services.audio_assets import InMemoryAudioStore
from language_coach.services.pairing import PairingToken


@dataclass(frozen=True)
class AppDependencies:
    settings: Settings
    pairing_token: PairingToken
    transcriber: Transcriber
    analyzer: SparkAnalyzer
    synthesizer: SpeechSynthesizer
    audio_store: InMemoryAudioStore
    clock: Clock
    close_providers: Callable[[], Awaitable[None]] | None = None


def build_production_dependencies() -> AppDependencies:
    settings = Settings()
    muse_key = settings.muse_api_key.get_secret_value() if settings.muse_api_key else "not-configured"
    spark_client = AsyncOpenAI(
        api_key=muse_key,
        base_url="https://api.meta.ai/v1",
        max_retries=0,
    )

    async def close_providers() -> None:
        await spark_client.close()

    return AppDependencies(
        settings=settings,
        pairing_token=PairingToken(),
        transcriber=MuseTranscriber(muse_key),
        analyzer=MuseSparkAnalyzer(spark_client),
        synthesizer=DeviceSpeechSynthesizer(),
        audio_store=InMemoryAudioStore(),
        clock=SystemClock(),
        close_providers=close_providers,
    )
