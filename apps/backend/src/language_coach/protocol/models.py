from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, model_validator

PROTOCOL_VERSION = 1

ConnectionState = Literal["idle", "connecting", "active", "degraded", "ended"]
Activity = Literal["listening", "analyzing", "audio_pending", "speaking"]
ParticipantId = Literal["learner_1", "learner_2", "fluent_partner"]
CancellationReason = Literal[
    "preview_obsolete", "final_empty", "final_replaced", "session_ended"
]
PlaybackStopReason = Literal["human_speech", "connection_lost"]
PlaybackKind = Literal["audio_url", "device_speech"]
DegradedSubsystem = Literal["transcription", "translation", "speech"]
SessionEndedReason = Literal[
    "user_end", "lifetime", "muse_failure", "disconnect_timeout", "shutdown"
]
DegradedCode = Literal[
    "muse_start_failed",
    "muse_connection_lost",
    "analysis_unavailable",
    "speech_unavailable",
]
SessionErrorCode = Literal[
    "invalid_state",
    "protocol_error",
    "resume_unavailable",
    "unsupported_language",
    "internal_error",
]


class WireModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SessionConfig(WireModel):
    mode: Literal["learner_fluent", "two_learners"]
    learning_language: str = Field(min_length=1)
    learner1_native_language: str = Field(min_length=1)
    learner2_native_language: str | None = None

    @model_validator(mode="after")
    def validate_languages(self) -> "SessionConfig":
        if self.learning_language == self.learner1_native_language:
            raise ValueError("learner 1 native language must differ from learning language")
        if self.mode == "two_learners" and self.learner2_native_language is None:
            raise ValueError("two-learner mode requires learner 2 native language")
        if self.mode == "learner_fluent" and self.learner2_native_language is not None:
            raise ValueError("learner-plus-fluent mode cannot configure learner 2")
        if self.learner2_native_language == self.learning_language:
            raise ValueError("learner 2 native language must differ from learning language")
        return self


class SessionStart(WireModel):
    type: Literal["session.start"]
    protocol_version: Literal[1]
    pairing_token: str = Field(min_length=32)
    config: SessionConfig


class SessionResume(WireModel):
    type: Literal["session.resume"]
    protocol_version: Literal[1]
    pairing_token: str = Field(min_length=32)
    session_id: UUID
    resume_token: str = Field(min_length=32)
    last_sequence: int = Field(ge=0)


class AudioStart(WireModel):
    type: Literal["audio.start"]
    protocol_version: Literal[1]


class AudioStop(WireModel):
    type: Literal["audio.stop"]
    protocol_version: Literal[1]


class SpeakersSwap(WireModel):
    type: Literal["speakers.swap"]
    protocol_version: Literal[1]


class PlaybackStarted(WireModel):
    type: Literal["playback.started"]
    protocol_version: Literal[1]
    intervention_id: UUID
    manual: bool = False


class PlaybackEnded(WireModel):
    type: Literal["playback.ended"]
    protocol_version: Literal[1]
    intervention_id: UUID


class PlaybackInterrupted(WireModel):
    type: Literal["playback.interrupted"]
    protocol_version: Literal[1]
    intervention_id: UUID


class InterventionAudioRetry(WireModel):
    type: Literal["intervention.audio_retry"]
    protocol_version: Literal[1]
    intervention_id: UUID


class SessionEnd(WireModel):
    type: Literal["session.end"]
    protocol_version: Literal[1]


ClientMessage = Annotated[
    SessionStart
    | SessionResume
    | AudioStart
    | AudioStop
    | SpeakersSwap
    | PlaybackStarted
    | PlaybackEnded
    | PlaybackInterrupted
    | InterventionAudioRetry
    | SessionEnd,
    Field(discriminator="type"),
]
ClientMessageAdapter: TypeAdapter[ClientMessage] = TypeAdapter(ClientMessage)


class ServerEnvelope(WireModel):
    protocol_version: Literal[1]
    session_id: UUID
    sequence: int = Field(ge=0)


class SessionReady(ServerEnvelope):
    type: Literal["session.ready"]
    resume_token: str = Field(min_length=32)
    resumed: bool


class SessionStatus(ServerEnvelope):
    type: Literal["session.status"]
    connection_state: ConnectionState
    activities: list[Activity]


class SessionWarning(ServerEnvelope):
    type: Literal["session.warning"]
    reason: Literal["expiring"]
    seconds_remaining: int = Field(ge=0)


class SpeakerMapped(ServerEnvelope):
    type: Literal["speaker.mapped"]
    provider_label: str = Field(min_length=1)
    participant_id: ParticipantId
    display_label: str = Field(min_length=1)


class InterventionPreview(ServerEnvelope):
    type: Literal["intervention.preview"]
    turn_id: str
    intervention_id: UUID
    participant_id: ParticipantId
    revision: int = Field(ge=1)
    source_text: str = Field(min_length=1)
    source_language: str = Field(min_length=1)
    target_text: str = Field(min_length=1)
    target_language: str = Field(min_length=1)


class InterventionCommitted(ServerEnvelope):
    type: Literal["intervention.committed"]
    turn_id: str
    intervention_id: UUID
    participant_id: ParticipantId
    source_text: str = Field(min_length=1)
    source_language: str = Field(min_length=1)
    target_text: str = Field(min_length=1)
    target_language: str = Field(min_length=1)


class InterventionAudioReady(ServerEnvelope):
    type: Literal["intervention.audio_ready"]
    turn_id: str
    intervention_id: UUID
    playback_kind: PlaybackKind
    audio_url: str | None


class InterventionAudioFailed(ServerEnvelope):
    type: Literal["intervention.audio_failed"]
    turn_id: str
    intervention_id: UUID
    retry_available: bool


class InterventionCancelled(ServerEnvelope):
    type: Literal["intervention.cancelled"]
    turn_id: str
    intervention_id: UUID
    reason: CancellationReason


class PlaybackStartRequested(ServerEnvelope):
    type: Literal["playback.start_requested"]
    intervention_id: UUID


class PlaybackStopRequested(ServerEnvelope):
    type: Literal["playback.stop_requested"]
    intervention_id: UUID
    reason: PlaybackStopReason


class SessionDegraded(ServerEnvelope):
    type: Literal["session.degraded"]
    subsystem: DegradedSubsystem
    code: DegradedCode
    recoverable: bool
    restart_required: bool


class SessionError(ServerEnvelope):
    type: Literal["session.error"]
    code: SessionErrorCode
    message: str = Field(min_length=1)
    recoverable: bool


class SessionEnded(ServerEnvelope):
    type: Literal["session.ended"]
    reason: SessionEndedReason


ServerEvent = Annotated[
    SessionReady
    | SessionStatus
    | SessionWarning
    | SpeakerMapped
    | InterventionPreview
    | InterventionCommitted
    | InterventionAudioReady
    | InterventionAudioFailed
    | InterventionCancelled
    | PlaybackStartRequested
    | PlaybackStopRequested
    | SessionDegraded
    | SessionError
    | SessionEnded,
    Field(discriminator="type"),
]
ServerEventAdapter: TypeAdapter[ServerEvent] = TypeAdapter(ServerEvent)


class SessionReadyPayload(WireModel):
    type: Literal["session.ready"] = "session.ready"
    resume_token: str = Field(min_length=32)
    resumed: bool


class SessionStatusPayload(WireModel):
    type: Literal["session.status"] = "session.status"
    connection_state: ConnectionState
    activities: list[Activity]


class SessionWarningPayload(WireModel):
    type: Literal["session.warning"] = "session.warning"
    reason: Literal["expiring"] = "expiring"
    seconds_remaining: int = Field(ge=0)


class SpeakerMappedPayload(WireModel):
    type: Literal["speaker.mapped"] = "speaker.mapped"
    provider_label: str
    participant_id: ParticipantId
    display_label: str


class InterventionPreviewPayload(WireModel):
    type: Literal["intervention.preview"] = "intervention.preview"
    turn_id: str
    intervention_id: UUID
    participant_id: ParticipantId
    revision: int = Field(ge=1)
    source_text: str
    source_language: str
    target_text: str
    target_language: str


class InterventionCommittedPayload(WireModel):
    type: Literal["intervention.committed"] = "intervention.committed"
    turn_id: str
    intervention_id: UUID
    participant_id: ParticipantId
    source_text: str
    source_language: str
    target_text: str
    target_language: str


class InterventionAudioReadyPayload(WireModel):
    type: Literal["intervention.audio_ready"] = "intervention.audio_ready"
    turn_id: str
    intervention_id: UUID
    playback_kind: PlaybackKind
    audio_url: str | None


class InterventionAudioFailedPayload(WireModel):
    type: Literal["intervention.audio_failed"] = "intervention.audio_failed"
    turn_id: str
    intervention_id: UUID
    retry_available: bool


class InterventionCancelledPayload(WireModel):
    type: Literal["intervention.cancelled"] = "intervention.cancelled"
    turn_id: str
    intervention_id: UUID
    reason: CancellationReason


class PlaybackStartRequestedPayload(WireModel):
    type: Literal["playback.start_requested"] = "playback.start_requested"
    intervention_id: UUID


class PlaybackStopRequestedPayload(WireModel):
    type: Literal["playback.stop_requested"] = "playback.stop_requested"
    intervention_id: UUID
    reason: PlaybackStopReason


class SessionDegradedPayload(WireModel):
    type: Literal["session.degraded"] = "session.degraded"
    subsystem: DegradedSubsystem
    code: DegradedCode
    recoverable: bool
    restart_required: bool


class SessionErrorPayload(WireModel):
    type: Literal["session.error"] = "session.error"
    code: SessionErrorCode
    message: str
    recoverable: bool


class SessionEndedPayload(WireModel):
    type: Literal["session.ended"] = "session.ended"
    reason: SessionEndedReason


ServerEventPayload = Annotated[
    SessionReadyPayload
    | SessionStatusPayload
    | SessionWarningPayload
    | SpeakerMappedPayload
    | InterventionPreviewPayload
    | InterventionCommittedPayload
    | InterventionAudioReadyPayload
    | InterventionAudioFailedPayload
    | InterventionCancelledPayload
    | PlaybackStartRequestedPayload
    | PlaybackStopRequestedPayload
    | SessionDegradedPayload
    | SessionErrorPayload
    | SessionEndedPayload,
    Field(discriminator="type"),
]
ServerEventPayloadAdapter: TypeAdapter[ServerEventPayload] = TypeAdapter(ServerEventPayload)
