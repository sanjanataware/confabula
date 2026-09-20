import { initialConversationState } from '../../src/conversation/model';
import { reduceConversation } from '../../src/protocol/reducer';
import type { ServerEvent } from '../../src/protocol/generated';

const sessionId = '00000000-0000-4000-8000-000000000001';
const interventionId = '00000000-0000-4000-8000-000000000002';

function event(value: Record<string, unknown>): ServerEvent {
  return {
    protocol_version: 1,
    session_id: sessionId,
    sequence: 0,
    ...value,
  } as ServerEvent;
}

test('preview commits in place and becomes replayable', () => {
  let state = reduceConversation(
    initialConversationState,
    event({ type: 'session.ready', resume_token: 'r'.repeat(43), resumed: false }),
  );
  state = reduceConversation(
    state,
    event({
      type: 'intervention.preview',
      sequence: 1,
      turn_id: 'turn-a',
      intervention_id: interventionId,
      participant_id: 'learner_1',
      revision: 1,
      source_text: 'grocery store',
      source_language: 'en',
      target_text: 'supermercado',
      target_language: 'es',
    }),
  );
  state = reduceConversation(
    state,
    event({
      type: 'intervention.committed',
      sequence: 2,
      turn_id: 'turn-a',
      intervention_id: interventionId,
      participant_id: 'learner_1',
      source_text: 'grocery store',
      source_language: 'en',
      target_text: 'supermercado',
      target_language: 'es',
    }),
  );
  state = reduceConversation(
    state,
    event({
      type: 'intervention.audio_ready',
      sequence: 3,
      turn_id: 'turn-a',
      intervention_id: interventionId,
      playback_kind: 'device_speech',
      audio_url: null,
    }),
  );
  expect(state.interventionOrder).toEqual([interventionId]);
  expect(state.interventions[interventionId].status).toBe('audio_ready');
  expect(state.interventions[interventionId].replayAvailable).toBe(true);
});

test('ignores events for another session and duplicate sequences', () => {
  const active = {
    ...initialConversationState,
    sessionId,
    lastSequence: 3,
  };
  expect(
    reduceConversation(
      active,
      event({ type: 'session.ended', sequence: 4, session_id: `${sessionId.slice(0, -1)}9`, reason: 'user_end' }),
    ),
  ).toBe(active);
  expect(
    reduceConversation(
      active,
      event({ type: 'session.ended', sequence: 3, reason: 'user_end' }),
    ),
  ).toBe(active);
});
