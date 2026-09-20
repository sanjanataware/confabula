from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Protocol
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from language_coach.domain.models import TranscriptionEvent


@dataclass(frozen=True)
class TranscriptionConfig:
    application_session_id: UUID
    muse_bias_names: tuple[str, ...]
    model: str = "muse-voice-transcribe-1.0"
    encoding: str = "PCM_24KHZ"
    mode: str = "DIARIZATION"
    partial_mode: str = "CUMULATIVE"


@dataclass(frozen=True)
class AnalysisRequest:
    participant: str
    native_language: str
    learning_language: str
    transcript: str
    context: tuple[str, ...]
    final: bool


class InterventionCandidate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_text: str = Field(min_length=1, max_length=160)
    source_language: str = Field(min_length=1, max_length=80)
    target_text: str = Field(min_length=1, max_length=240)
    target_language: str = Field(min_length=1, max_length=80)

    @field_validator(
        "source_text", "source_language", "target_text", "target_language"
    )
    @classmethod
    def reject_whitespace_only(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("field cannot be blank")
        return stripped


class InterventionAnalysis(BaseModel):
    model_config = ConfigDict(extra="forbid")

    interventions: list[InterventionCandidate] = Field(max_length=3)


@dataclass(frozen=True)
class SpeechRequest:
    target_text: str
    target_language_code: str


@dataclass(frozen=True)
class AudioAsset:
    content_type: str
    data: bytes


class InvalidPcmFrame(ValueError):
    pass


class MuseStartFailed(RuntimeError):
    pass


class AnalysisUnavailable(RuntimeError):
    pass


class SpeechSynthesisUnavailable(RuntimeError):
    pass


class TranscriptionSession(Protocol):
    async def send_pcm(self, frame: bytes) -> None: ...

    def events(self) -> AsyncIterator[TranscriptionEvent]: ...

    async def close(self) -> None: ...


class Transcriber(Protocol):
    async def open(self, config: TranscriptionConfig) -> TranscriptionSession: ...


class SparkAnalyzer(Protocol):
    async def analyze(self, request: AnalysisRequest) -> InterventionAnalysis: ...


class SpeechSynthesizer(Protocol):
    async def synthesize(self, request: SpeechRequest) -> AudioAsset: ...
