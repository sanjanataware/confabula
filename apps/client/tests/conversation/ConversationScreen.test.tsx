import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';

import { ConversationScreen } from '../../src/conversation/ConversationScreen';
import { initialConversationState, type ConversationState } from '../../src/conversation/model';
import type { SessionContextValue } from '../../src/session/SessionProvider';
import { createSetupModel } from '../../src/setup/model';

const mockRouter = { replace: jest.fn() };
let mockSession: SessionContextValue;
jest.mock('expo-keep-awake', () => ({ useKeepAwake: jest.fn() }));
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('../../src/session/SessionProvider', () => ({ useSession: () => mockSession }));

const card = {
  id: 'a', turnId: 'turn-a', participantId: 'learner_1' as const,
  sourceText: 'grocery store', sourceLanguage: 'en', targetText: 'supermercado', targetLanguage: 'es',
  status: 'preview' as const, retryAvailable: false, replayAvailable: false,
};
const activeState: ConversationState = {
  ...initialConversationState, connectionState: 'active', activities: ['listening'],
  sessionId: '00000000-0000-4000-8000-000000000001',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockSession = {
    state: activeState, setup: createSetupModel(), starting: false, error: null,
    captureEnabled: true, captureState: 'capturing', startConversation: jest.fn(),
    sendControl: jest.fn(() => true), replay: jest.fn(), endConversation: jest.fn(),
  };
});

test('ordinary conversation renders no transcript or unrelated product features', async () => {
  await render(<ConversationScreen />);
  expect(screen.getByText('Listening for useful moments')).toBeTruthy();
  for (const name of ['Transcript', 'History', 'Lesson', 'Save', 'Account']) {
    expect(screen.queryByText(name)).toBeNull();
  }
  expect(screen.queryByText('Swap speakers')).toBeNull();
});

test('a preview commits in place and replay or one retry follows card state', async () => {
  mockSession.state = { ...activeState, interventions: { a: card }, interventionOrder: ['a'] };
  const view = await render(<ConversationScreen />);
  expect(screen.getByText('grocery store')).toBeTruthy();
  expect(screen.getByText('supermercado')).toBeTruthy();
  expect(screen.getByText('Checking…')).toBeTruthy();
  mockSession.state = {
    ...mockSession.state,
    interventions: { a: { ...card, status: 'audio_failed', retryAvailable: true } },
  };
  await view.rerender(<ConversationScreen />);
  expect(screen.getAllByTestId('intervention-a')).toHaveLength(1);
  await fireEvent.press(screen.getByRole('button', { name: 'Retry speech' }));
  expect(mockSession.sendControl).toHaveBeenCalledWith({ type: 'intervention.audio_retry', protocol_version: 1, intervention_id: 'a' });
  mockSession.state = {
    ...mockSession.state,
    interventions: { a: { ...card, status: 'interrupted', audioUrl: 'https://localhost/audio', replayAvailable: true } },
  };
  await view.rerender(<ConversationScreen />);
  expect(screen.queryByRole('button', { name: 'Retry speech' })).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Replay supermercado' }));
  expect(mockSession.replay).toHaveBeenCalledWith('a');
});

test('two mapped learners can swap and end without a history decision', async () => {
  mockSession.setup = { ...createSetupModel(), mode: 'two_learners' };
  mockSession.state = { ...activeState, speakers: {
    A: { providerLabel: 'A', participantId: 'learner_1', displayLabel: 'Learner 1' },
    B: { providerLabel: 'B', participantId: 'learner_2', displayLabel: 'Learner 2' },
  } };
  await render(<ConversationScreen />);
  await fireEvent.press(screen.getByRole('button', { name: 'Swap speakers' }));
  expect(mockSession.sendControl).toHaveBeenCalledWith({ type: 'speakers.swap', protocol_version: 1 });
  await fireEvent.press(screen.getByRole('button', { name: 'End' }));
  expect(mockSession.endConversation).toHaveBeenCalled();
  expect(mockRouter.replace).toHaveBeenCalledWith('/');
});

test('native backgrounding invokes the same idempotent foreground cleanup', async () => {
  let changed!: (state: AppStateStatus) => void;
  const subscription = jest.spyOn(AppState, 'addEventListener').mockImplementation((_, callback) => {
    changed = callback;
    return { remove: jest.fn() };
  });
  await render(<ConversationScreen />);
  await act(async () => { changed('background'); changed('inactive'); });
  expect(mockSession.endConversation).toHaveBeenCalledTimes(1);
  subscription.mockRestore();
});
