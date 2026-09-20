import type { ConversationState, InterventionCardModel } from '../conversation/model';
import { initialConversationState } from '../conversation/model';
import type { ServerEvent } from './generated';

export type LocalConnectionLost = { type: 'local.connection_lost' };
export type ConversationAction = ServerEvent | LocalConnectionLost
  | { type: 'local.playback_started'; interventionId: string }
  | { type: 'local.playback_ended'; interventionId: string; interrupted: boolean }
  | { type: 'local.restart_required'; message: string };

function upsertCard(
  state: ConversationState,
  card: InterventionCardModel,
): ConversationState {
  const exists = card.id in state.interventions;
  return {
    ...state,
    interventions: { ...state.interventions, [card.id]: card },
    interventionOrder: exists
      ? state.interventionOrder
      : [card.id, ...state.interventionOrder],
  };
}

function updateCard(
  state: ConversationState,
  id: string,
  update: Partial<InterventionCardModel>,
): ConversationState {
  const current = state.interventions[id];
  if (!current) {
    return state;
  }
  return {
    ...state,
    interventions: {
      ...state.interventions,
      [id]: { ...current, ...update },
    },
  };
}

function removeCard(state: ConversationState, id: string): ConversationState {
  const { [id]: removed, ...interventions } = state.interventions;
  if (!removed) {
    return state;
  }
  return {
    ...state,
    interventions,
    interventionOrder: state.interventionOrder.filter((item) => item !== id),
  };
}

export function reduceConversation(
  state: ConversationState,
  action: ConversationAction,
): ConversationState {
  if (action.type === 'local.connection_lost') {
    const current = state.currentPlaybackId;
    const disconnected = current
      ? updateCard(state, current, {
          status: 'interrupted',
          replayAvailable: Boolean(state.interventions[current]?.playbackKind),
        })
      : state;
    return {
      ...disconnected,
      connectionState: 'degraded',
      activities: disconnected.activities.filter((item) => item !== 'speaking'),
      currentPlaybackId: null,
      degradedCode: 'connection_lost',
    };
  }

  if (action.type === 'local.restart_required') {
    return {
      ...initialConversationState, connectionState: 'degraded',
      restartRequired: true, errorMessage: action.message,
    };
  }
  if (action.type === 'local.playback_started') {
    return {
      ...state, currentPlaybackId: action.interventionId,
      activities: [...state.activities.filter((item) => item !== 'speaking'), 'speaking'],
    };
  }
  if (action.type === 'local.playback_ended') {
    const updated = updateCard(state, action.interventionId, {
      status: action.interrupted ? 'interrupted' : 'audio_ready',
      replayAvailable: Boolean(state.interventions[action.interventionId]?.playbackKind),
    });
    return state.currentPlaybackId === action.interventionId ? {
      ...updated, currentPlaybackId: null,
      activities: updated.activities.filter((item) => item !== 'speaking'),
    } : updated;
  }

  if (state.sessionId && action.session_id !== state.sessionId) {
    return state;
  }
  if (action.sequence <= state.lastSequence) {
    return state;
  }

  let next: ConversationState = {
    ...state,
    sessionId: state.sessionId ?? action.session_id,
    lastSequence: action.sequence,
  };

  switch (action.type) {
    case 'session.ready':
      return {
        ...next,
        connectionState: action.resumed ? next.connectionState : 'idle',
        degradedCode: null,
        restartRequired: false,
      };
    case 'session.status':
      return {
        ...next,
        connectionState: action.connection_state,
        activities: action.activities,
      };
    case 'session.warning':
      return { ...next, secondsRemaining: action.seconds_remaining };
    case 'speaker.mapped':
      return {
        ...next,
        speakers: {
          ...next.speakers,
          [action.provider_label]: {
            providerLabel: action.provider_label,
            participantId: action.participant_id,
            displayLabel: action.display_label,
          },
        },
      };
    case 'intervention.preview':
      if (Object.values(next.interventions).some((card) => card.turnId === action.turn_id && card.status !== 'preview')) return next;
      return upsertCard(next, {
        id: action.intervention_id,
        turnId: action.turn_id,
        participantId: action.participant_id,
        sourceText: action.source_text,
        sourceLanguage: action.source_language,
        targetText: action.target_text,
        targetLanguage: action.target_language,
        status: 'preview',
        revision: action.revision,
        retryAvailable: false,
        replayAvailable: false,
      });
    case 'intervention.committed': {
      const existing = next.interventions[action.intervention_id];
      return upsertCard(next, {
        id: action.intervention_id,
        turnId: action.turn_id,
        participantId: action.participant_id,
        sourceText: action.source_text,
        sourceLanguage: action.source_language,
        targetText: action.target_text,
        targetLanguage: action.target_language,
        status: 'committed',
        revision: existing?.revision,
        playbackKind: existing?.playbackKind,
        audioUrl: existing?.audioUrl,
        retryAvailable: false,
        replayAvailable: existing?.replayAvailable ?? false,
      });
    }
    case 'intervention.audio_ready':
      return updateCard(next, action.intervention_id, {
        status: 'audio_ready',
        playbackKind: action.playback_kind,
        audioUrl: action.audio_url ?? undefined,
        replayAvailable: true,
        retryAvailable: false,
      });
    case 'intervention.audio_failed':
      return updateCard(next, action.intervention_id, {
        status: 'audio_failed',
        retryAvailable: action.retry_available,
      });
    case 'intervention.cancelled':
      return next.interventions[action.intervention_id]?.status === 'preview'
        ? removeCard(next, action.intervention_id)
        : next;
    case 'playback.start_requested':
      return { ...next, currentPlaybackId: action.intervention_id };
    case 'playback.stop_requested':
      next = updateCard(next, action.intervention_id, {
        status: 'interrupted',
        replayAvailable: Boolean(
          next.interventions[action.intervention_id]?.playbackKind,
        ),
      });
      return {
        ...next,
        currentPlaybackId:
          next.currentPlaybackId === action.intervention_id
            ? null
            : next.currentPlaybackId,
        activities: next.activities.filter((item) => item !== 'speaking'),
      };
    case 'session.degraded':
      return {
        ...next,
        connectionState: 'degraded',
        degradedCode: action.code,
        restartRequired: action.restart_required,
      };
    case 'session.error':
      return {
        ...next,
        errorMessage: action.message,
        restartRequired: !action.recoverable,
      };
    case 'session.ended':
      return {
        ...initialConversationState,
        lastSequence: action.sequence,
        connectionState: 'ended',
        endedReason: action.reason,
      };
    default:
      return next;
  }
}
