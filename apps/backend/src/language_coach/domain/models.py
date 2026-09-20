from dataclasses import dataclass
from enum import StrEnum


class ConversationMode(StrEnum):
    LEARNER_FLUENT = "learner_fluent"
    TWO_LEARNERS = "two_learners"


class ParticipantId(StrEnum):
    LEARNER_1 = "learner_1"
    LEARNER_2 = "learner_2"
    FLUENT_PARTNER = "fluent_partner"


@dataclass(frozen=True)
class SpeechStarted:
    turn_id: str
    audio_processed_ms: int


@dataclass(frozen=True)
class SpeechEnded:
    turn_id: str
    audio_processed_ms: int


@dataclass(frozen=True)
class TranscriptPartial:
    turn_id: str
    revision: int
    text: str
    audio_processed_ms: int


PartialTranscript = TranscriptPartial


@dataclass(frozen=True)
class SpeakerObserved:
    turn_id: str
    label: str
    audio_processed_ms: int


@dataclass(frozen=True)
class SpeechCompleted:
    turn_id: str
    text: str
    speaker_label: str | None
    audio_processed_ms: int


@dataclass(frozen=True)
class TranscriptionFailure:
    code: str = "muse_connection_lost"
    restart_required: bool = True


type TranscriptionEvent = (
    SpeechStarted
    | SpeechEnded
    | TranscriptPartial
    | SpeakerObserved
    | SpeechCompleted
    | TranscriptionFailure
)


@dataclass
class TurnRecord:
    turn_id: str
    revision: int = 0
    text: str = ""
    speaker_label: str | None = None
    started_at_ms: int | None = None
    completed_at_ms: int | None = None
    final: bool = False
