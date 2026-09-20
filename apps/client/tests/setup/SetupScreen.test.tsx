import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { getLocales } from 'expo-localization';

import { discoverBackend } from '../../src/services/capabilities';
import { SetupScreen } from '../../src/setup/SetupScreen';

jest.mock('@react-native-picker/picker', () => {
  const React = jest.requireActual('react');
  const Picker = (props: object) => React.createElement('Picker', props);
  Picker.Item = () => null;
  return { Picker };
});

const mockRouter = { replace: jest.fn() };
const mockStart = jest.fn(async () => true);
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('expo-localization', () => ({ getLocales: jest.fn(() => [{ languageCode: 'en' }]) }));
jest.mock('../../src/services/capabilities', () => ({
  ...jest.requireActual('../../src/services/capabilities'), discoverBackend: jest.fn(),
}));
jest.mock('../../src/session/SessionProvider', () => ({
  useSession: () => ({ startConversation: mockStart, starting: false, error: null }),
}));

const discovery = {
  health: { status: 'ok' as const, protocol_version: 1 as const, providers: { meta: true, device_speech: true } },
  capabilities: {
    protocol_version: 1 as const,
    languages: [
      { code: 'en', display_name: 'English', muse_bias_name: 'English', speech_route: { kind: 'device_speech' as const } },
      { code: 'es', display_name: 'Spanish', muse_bias_name: 'Spanish', speech_route: { kind: 'device_speech' as const } },
    ],
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(discoverBackend).mockResolvedValue(discovery);
  jest.mocked(getLocales).mockReturnValue([{ languageCode: 'en' }] as unknown as ReturnType<typeof getLocales>);
});

test('backend languages and a supported locale populate the form; disclosure gates startup', async () => {
  await render(<SetupScreen />);
  await screen.findByText('Meta and on-device speech are ready.');
  expect(screen.getByTestId('learner-1-language').props.selectedValue).toBe('en');
  expect(screen.getByRole('button', { name: 'Start conversation' })).toBeDisabled();
  await fireEvent(screen.getByTestId('learning-language'), 'valueChange', 'es');
  await fireEvent.changeText(screen.getByTestId('pairing-token'), 'p'.repeat(43));
  expect(screen.getByRole('button', { name: 'Start conversation' })).toBeDisabled();
  expect(screen.getByText(/microphone audio and text go to Meta/)).toBeTruthy();
  await fireEvent.press(screen.getByTestId('processing-disclosure'));
  await fireEvent.press(screen.getByRole('button', { name: 'Start conversation' }));
  await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/conversation'));
  expect(mockStart).toHaveBeenCalledTimes(1);
});

test('same language is shown inline even though the disabled start button cannot be pressed', async () => {
  await render(<SetupScreen />);
  await screen.findByText('Meta and on-device speech are ready.');
  await fireEvent(screen.getByTestId('learning-language'), 'valueChange', 'en');
  expect(screen.getByText('The native and learning languages must be different.')).toBeTruthy();
});

test('unknown device locales are not guessed and two-learner mode can be toggled off', async () => {
  jest.mocked(getLocales).mockReturnValue([{ languageCode: 'unknown' }] as unknown as ReturnType<typeof getLocales>);
  await render(<SetupScreen />);
  await screen.findByText('Meta and on-device speech are ready.');
  expect(screen.getByTestId('learner-1-language').props.selectedValue).toBe('');
  await fireEvent(screen.getByTestId('two-learners'), 'valueChange', true);
  expect(screen.getByTestId('learner-2-language')).toBeTruthy();
  await fireEvent(screen.getByTestId('learner-2-language'), 'valueChange', 'en');
  await fireEvent(screen.getByTestId('two-learners'), 'valueChange', false);
  expect(screen.queryByTestId('learner-2-language')).toBeNull();
});

test('backend failure can be retried with an accessible button', async () => {
  jest.mocked(discoverBackend).mockRejectedValueOnce(new Error('unavailable'));
  await render(<SetupScreen />);
  await screen.findByText(/Could not reach the backend/);
  await fireEvent.press(screen.getByRole('button', { name: 'Check backend' }));
  await screen.findByText('Meta and on-device speech are ready.');
});

test('missing readiness names the provider rather than a key value', async () => {
  jest.mocked(discoverBackend).mockResolvedValue({
    ...discovery,
    health: { ...discovery.health, status: 'not_ready', providers: { meta: false, device_speech: true } },
  });
  await render(<SetupScreen />);
  await screen.findByText('Backend needs Meta configuration.');
  expect(screen.getByRole('button', { name: 'Start conversation' })).toBeDisabled();
});
