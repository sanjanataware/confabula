export type ConnectionState =
  | 'idle'
  | 'connecting'
  | 'active'
  | 'degraded'
  | 'ended';

export type Activity = 'listening' | 'analyzing' | 'audio_pending' | 'speaking';
export type ParticipantId = 'learner_1' | 'learner_2' | 'fluent_partner';

export type SpeakerAssignment = {
  providerLabel: string;
  participantId: ParticipantId;
  displayLabel: string;
};

export type InterventionCardModel = {
  id: string;
  turnId: string;
  participantId: ParticipantId;
  sourceText: string;
  sourceLanguage: string;
  targetText: string;
  targetLanguage: string;
  status: 'preview' | 'committed' | 'audio_ready' | 'audio_failed' | 'interrupted';
  revision?: number;
  playbackKind?: 'audio_url' | 'device_speech';
  audioUrl?: string;
  retryAvailable: boolean;
  replayAvailable: boolean;
};

export type ConversationState = {
  sessionId: string | null;
  lastSequence: number;
  connectionState: ConnectionState;
  activities: Activity[];
  speakers: Record<string, SpeakerAssignment>;
  interventions: Record<string, InterventionCardModel>;
  interventionOrder: string[];
  currentPlaybackId: string | null;
  secondsRemaining: number | null;
  degradedCode: string | null;
  errorMessage: string | null;
  restartRequired: boolean;
  endedReason: string | null;
};

export const initialConversationState: ConversationState = {
  sessionId: null,
  lastSequence: -1,
  connectionState: 'idle',
  activities: [],
  speakers: {},
  interventions: {},
  interventionOrder: [],
  currentPlaybackId: null,
  secondsRemaining: null,
  degradedCode: null,
  errorMessage: null,
  restartRequired: false,
  endedReason: null,
};
