export namespace ClientProtocol {
export type ClientMessages =
  | SessionStart
  | SessionResume
  | AudioStart
  | AudioStop
  | SpeakersSwap
  | PlaybackStarted
  | PlaybackEnded
  | PlaybackInterrupted
  | InterventionAudioRetry
  | SessionEnd;
export type Learner1NativeLanguage = string;
export type Learner2NativeLanguage = string | null;
export type LearningLanguage = string;
export type Mode = 'learner_fluent' | 'two_learners';
export type PairingToken = string;
export type ProtocolVersion = 1;
export type Type = 'session.start';
export type LastSequence = number;
export type PairingToken1 = string;
export type ProtocolVersion1 = 1;
export type ResumeToken = string;
export type SessionId = string;
export type Type1 = 'session.resume';
export type ProtocolVersion2 = 1;
export type Type2 = 'audio.start';
export type ProtocolVersion3 = 1;
export type Type3 = 'audio.stop';
export type ProtocolVersion4 = 1;
export type Type4 = 'speakers.swap';
export type InterventionId = string;
export type Manual = boolean;
export type ProtocolVersion5 = 1;
export type Type5 = 'playback.started';
export type InterventionId1 = string;
export type ProtocolVersion6 = 1;
export type Type6 = 'playback.ended';
export type InterventionId2 = string;
export type ProtocolVersion7 = 1;
export type Type7 = 'playback.interrupted';
export type InterventionId3 = string;
export type ProtocolVersion8 = 1;
export type Type8 = 'intervention.audio_retry';
export type ProtocolVersion9 = 1;
export type Type9 = 'session.end';

export interface SessionStart {
  config: SessionConfig;
  pairing_token: PairingToken;
  protocol_version: ProtocolVersion;
  type: Type;
}
export interface SessionConfig {
  learner1_native_language: Learner1NativeLanguage;
  learner2_native_language?: Learner2NativeLanguage;
  learning_language: LearningLanguage;
  mode: Mode;
}
export interface SessionResume {
  last_sequence: LastSequence;
  pairing_token: PairingToken1;
  protocol_version: ProtocolVersion1;
  resume_token: ResumeToken;
  session_id: SessionId;
  type: Type1;
}
export interface AudioStart {
  protocol_version: ProtocolVersion2;
  type: Type2;
}
export interface AudioStop {
  protocol_version: ProtocolVersion3;
  type: Type3;
}
export interface SpeakersSwap {
  protocol_version: ProtocolVersion4;
  type: Type4;
}
export interface PlaybackStarted {
  intervention_id: InterventionId;
  manual?: Manual;
  protocol_version: ProtocolVersion5;
  type: Type5;
}
export interface PlaybackEnded {
  intervention_id: InterventionId1;
  protocol_version: ProtocolVersion6;
  type: Type6;
}
export interface PlaybackInterrupted {
  intervention_id: InterventionId2;
  protocol_version: ProtocolVersion7;
  type: Type7;
}
export interface InterventionAudioRetry {
  intervention_id: InterventionId3;
  protocol_version: ProtocolVersion8;
  type: Type8;
}
export interface SessionEnd {
  protocol_version: ProtocolVersion9;
  type: Type9;
}
}

export namespace ServerProtocol {
export type ServerEvents =
  | SessionReady
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
  | SessionEnded;
export type ProtocolVersion = 1;
export type ResumeToken = string;
export type Resumed = boolean;
export type Sequence = number;
export type SessionId = string;
export type Type = 'session.ready';
export type Activities = ('listening' | 'analyzing' | 'audio_pending' | 'speaking')[];
export type ConnectionState = 'idle' | 'connecting' | 'active' | 'degraded' | 'ended';
export type ProtocolVersion1 = 1;
export type Sequence1 = number;
export type SessionId1 = string;
export type Type1 = 'session.status';
export type ProtocolVersion2 = 1;
export type Reason = 'expiring';
export type SecondsRemaining = number;
export type Sequence2 = number;
export type SessionId2 = string;
export type Type2 = 'session.warning';
export type DisplayLabel = string;
export type ParticipantId = 'learner_1' | 'learner_2' | 'fluent_partner';
export type ProtocolVersion3 = 1;
export type ProviderLabel = string;
export type Sequence3 = number;
export type SessionId3 = string;
export type Type3 = 'speaker.mapped';
export type InterventionId = string;
export type ParticipantId1 = 'learner_1' | 'learner_2' | 'fluent_partner';
export type ProtocolVersion4 = 1;
export type Revision = number;
export type Sequence4 = number;
export type SessionId4 = string;
export type SourceLanguage = string;
export type SourceText = string;
export type TargetLanguage = string;
export type TargetText = string;
export type TurnId = string;
export type Type4 = 'intervention.preview';
export type InterventionId1 = string;
export type ParticipantId2 = 'learner_1' | 'learner_2' | 'fluent_partner';
export type ProtocolVersion5 = 1;
export type Sequence5 = number;
export type SessionId5 = string;
export type SourceLanguage1 = string;
export type SourceText1 = string;
export type TargetLanguage1 = string;
export type TargetText1 = string;
export type TurnId1 = string;
export type Type5 = 'intervention.committed';
export type AudioUrl = string | null;
export type InterventionId2 = string;
export type PlaybackKind = 'audio_url' | 'device_speech';
export type ProtocolVersion6 = 1;
export type Sequence6 = number;
export type SessionId6 = string;
export type TurnId2 = string;
export type Type6 = 'intervention.audio_ready';
export type InterventionId3 = string;
export type ProtocolVersion7 = 1;
export type RetryAvailable = boolean;
export type Sequence7 = number;
export type SessionId7 = string;
export type TurnId3 = string;
export type Type7 = 'intervention.audio_failed';
export type InterventionId4 = string;
export type ProtocolVersion8 = 1;
export type Reason1 = 'preview_obsolete' | 'final_empty' | 'final_replaced' | 'session_ended';
export type Sequence8 = number;
export type SessionId8 = string;
export type TurnId4 = string;
export type Type8 = 'intervention.cancelled';
export type InterventionId5 = string;
export type ProtocolVersion9 = 1;
export type Sequence9 = number;
export type SessionId9 = string;
export type Type9 = 'playback.start_requested';
export type InterventionId6 = string;
export type ProtocolVersion10 = 1;
export type Reason2 = 'human_speech' | 'connection_lost';
export type Sequence10 = number;
export type SessionId10 = string;
export type Type10 = 'playback.stop_requested';
export type Code = 'muse_start_failed' | 'muse_connection_lost' | 'analysis_unavailable' | 'speech_unavailable';
export type ProtocolVersion11 = 1;
export type Recoverable = boolean;
export type RestartRequired = boolean;
export type Sequence11 = number;
export type SessionId11 = string;
export type Subsystem = 'transcription' | 'translation' | 'speech';
export type Type11 = 'session.degraded';
export type Code1 =
  'invalid_state' | 'protocol_error' | 'resume_unavailable' | 'unsupported_language' | 'internal_error';
export type Message = string;
export type ProtocolVersion12 = 1;
export type Recoverable1 = boolean;
export type Sequence12 = number;
export type SessionId12 = string;
export type Type12 = 'session.error';
export type ProtocolVersion13 = 1;
export type Reason3 = 'user_end' | 'lifetime' | 'muse_failure' | 'disconnect_timeout' | 'shutdown';
export type Sequence13 = number;
export type SessionId13 = string;
export type Type13 = 'session.ended';

export interface SessionReady {
  protocol_version: ProtocolVersion;
  resume_token: ResumeToken;
  resumed: Resumed;
  sequence: Sequence;
  session_id: SessionId;
  type: Type;
}
export interface SessionStatus {
  activities: Activities;
  connection_state: ConnectionState;
  protocol_version: ProtocolVersion1;
  sequence: Sequence1;
  session_id: SessionId1;
  type: Type1;
}
export interface SessionWarning {
  protocol_version: ProtocolVersion2;
  reason: Reason;
  seconds_remaining: SecondsRemaining;
  sequence: Sequence2;
  session_id: SessionId2;
  type: Type2;
}
export interface SpeakerMapped {
  display_label: DisplayLabel;
  participant_id: ParticipantId;
  protocol_version: ProtocolVersion3;
  provider_label: ProviderLabel;
  sequence: Sequence3;
  session_id: SessionId3;
  type: Type3;
}
export interface InterventionPreview {
  intervention_id: InterventionId;
  participant_id: ParticipantId1;
  protocol_version: ProtocolVersion4;
  revision: Revision;
  sequence: Sequence4;
  session_id: SessionId4;
  source_language: SourceLanguage;
  source_text: SourceText;
  target_language: TargetLanguage;
  target_text: TargetText;
  turn_id: TurnId;
  type: Type4;
}
export interface InterventionCommitted {
  intervention_id: InterventionId1;
  participant_id: ParticipantId2;
  protocol_version: ProtocolVersion5;
  sequence: Sequence5;
  session_id: SessionId5;
  source_language: SourceLanguage1;
  source_text: SourceText1;
  target_language: TargetLanguage1;
  target_text: TargetText1;
  turn_id: TurnId1;
  type: Type5;
}
export interface InterventionAudioReady {
  audio_url: AudioUrl;
  intervention_id: InterventionId2;
  playback_kind: PlaybackKind;
  protocol_version: ProtocolVersion6;
  sequence: Sequence6;
  session_id: SessionId6;
  turn_id: TurnId2;
  type: Type6;
}
export interface InterventionAudioFailed {
  intervention_id: InterventionId3;
  protocol_version: ProtocolVersion7;
  retry_available: RetryAvailable;
  sequence: Sequence7;
  session_id: SessionId7;
  turn_id: TurnId3;
  type: Type7;
}
export interface InterventionCancelled {
  intervention_id: InterventionId4;
  protocol_version: ProtocolVersion8;
  reason: Reason1;
  sequence: Sequence8;
  session_id: SessionId8;
  turn_id: TurnId4;
  type: Type8;
}
export interface PlaybackStartRequested {
  intervention_id: InterventionId5;
  protocol_version: ProtocolVersion9;
  sequence: Sequence9;
  session_id: SessionId9;
  type: Type9;
}
export interface PlaybackStopRequested {
  intervention_id: InterventionId6;
  protocol_version: ProtocolVersion10;
  reason: Reason2;
  sequence: Sequence10;
  session_id: SessionId10;
  type: Type10;
}
export interface SessionDegraded {
  code: Code;
  protocol_version: ProtocolVersion11;
  recoverable: Recoverable;
  restart_required: RestartRequired;
  sequence: Sequence11;
  session_id: SessionId11;
  subsystem: Subsystem;
  type: Type11;
}
export interface SessionError {
  code: Code1;
  message: Message;
  protocol_version: ProtocolVersion12;
  recoverable: Recoverable1;
  sequence: Sequence12;
  session_id: SessionId12;
  type: Type12;
}
export interface SessionEnded {
  protocol_version: ProtocolVersion13;
  reason: Reason3;
  sequence: Sequence13;
  session_id: SessionId13;
  type: Type13;
}
}

export type ClientMessage = ClientProtocol.ClientMessages;
export type SessionConfig = ClientProtocol.SessionConfig;
export type SessionStart = ClientProtocol.SessionStart;
export type SessionResume = ClientProtocol.SessionResume;
export type ServerEvent = ServerProtocol.ServerEvents;
export type SessionReady = ServerProtocol.SessionReady;
export type SessionStatus = ServerProtocol.SessionStatus;
export type SpeakerMapped = ServerProtocol.SpeakerMapped;
export type InterventionPreview = ServerProtocol.InterventionPreview;
export type InterventionCommitted = ServerProtocol.InterventionCommitted;
export type InterventionAudioReady = ServerProtocol.InterventionAudioReady;
export type InterventionAudioFailed = ServerProtocol.InterventionAudioFailed;
export type InterventionCancelled = ServerProtocol.InterventionCancelled;
export type PlaybackStartRequested = ServerProtocol.PlaybackStartRequested;
export type PlaybackStopRequested = ServerProtocol.PlaybackStopRequested;
export type SessionDegraded = ServerProtocol.SessionDegraded;
export type SessionEnded = ServerProtocol.SessionEnded;
