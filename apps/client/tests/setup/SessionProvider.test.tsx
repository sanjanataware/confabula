import { act, renderHook, waitFor } from '@testing-library/react-native';
import { requestRecordingPermissionsAsync } from 'expo-audio';

import type { ServerEvent } from '../../src/protocol/generated';
import { discoverBackend } from '../../src/services/capabilities';
import { SessionProvider, useSession } from '../../src/session/SessionProvider';
import { createSetupModel } from '../../src/setup/model';

const mockOrder: string[] = [];
const mockCapture = { start: jest.fn(async () => { mockOrder.push('capture'); return true; }), stop: jest.fn(), state: 'idle', diagnostics: {} };
const mockPlayer = { requestAutomatic: jest.fn(), replay: jest.fn(), stopRequested: jest.fn(), stopAll: jest.fn() };
let mockSocketOptions: { onEvent: (event: ServerEvent) => void };
const mockSocket = {
  isActive: false,
  credentials: null,
  start: jest.fn(async () => { mockOrder.push('pair'); }),
  startAudio: jest.fn(async () => { mockOrder.push('audio'); mockSocket.isActive = true; }),
  end: jest.fn(() => { mockSocket.isActive = false; }),
  sendAudio: jest.fn(), sendControl: jest.fn(),
};
jest.mock('expo-audio', () => ({ requestRecordingPermissionsAsync: jest.fn() }));
jest.mock('../../src/audio/usePcmCapture', () => ({ usePcmCapture: () => mockCapture }));
jest.mock('../../src/audio/useInterventionPlayer', () => ({ useInterventionPlayer: () => mockPlayer }));
jest.mock('../../src/protocol/sessionSocket', () => ({
  SessionSocket: jest.fn((options) => { mockSocketOptions = options; return mockSocket; }),
}));
jest.mock('../../src/services/capabilities', () => ({
  ...jest.requireActual('../../src/services/capabilities'), discoverBackend: jest.fn(),
}));

const setup = {
  ...createSetupModel(), pairingToken: 'p'.repeat(43),
  learner1NativeLanguage: 'en', learningLanguage: 'es', disclosureAccepted: true,
};
const discovery = {
  health: {
    protocol_version: 1 as const,
    status: 'ok' as const,
    providers: { meta: true, device_speech: true },
  },
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
  mockOrder.length = 0;
  mockSocket.isActive = false;
  mockSocket.start.mockImplementation(async () => { mockOrder.push('pair'); });
  jest.mocked(discoverBackend).mockImplementation(async () => { mockOrder.push('readiness'); return discovery; });
  jest.mocked(requestRecordingPermissionsAsync).mockImplementation(async () => {
    mockOrder.push('permission');
    return { granted: true } as Awaited<ReturnType<typeof requestRecordingPermissionsAsync>>;
  });
});

test('readiness and pairing precede permission, provider startup, and capture', async () => {
  const hook = await renderHook(() => useSession(), { wrapper: SessionProvider });
  await act(async () => { expect(await hook.result.current.startConversation(setup)).toBe(true); });
  expect(mockOrder).toEqual(['readiness', 'pair', 'permission', 'audio', 'capture']);
  expect(hook.result.current.setup?.pairingToken).toBe('');
  expect(hook.result.current.captureEnabled).toBe(true);
  await act(async () => hook.result.current.endConversation());
  expect(hook.result.current.setup).toBeNull();
  expect(hook.result.current.state.sessionId).toBeNull();
  expect(mockCapture.stop).toHaveBeenCalled();
  expect(mockPlayer.stopAll).toHaveBeenCalled();
  await hook.unmount();
});

test('pairing rejection never prompts for microphone permission', async () => {
  mockSocket.start.mockRejectedValueOnce(new Error('pairing_failed'));
  const hook = await renderHook(() => useSession(), { wrapper: SessionProvider });
  await act(async () => { expect(await hook.result.current.startConversation(setup)).toBe(false); });
  expect(requestRecordingPermissionsAsync).not.toHaveBeenCalled();
  expect(mockCapture.start).not.toHaveBeenCalled();
  expect(hook.result.current.error).toMatch(/Pairing failed/);
  await hook.unmount();
});

test('microphone denial ends the prepared server session', async () => {
  jest.mocked(requestRecordingPermissionsAsync).mockResolvedValue({ granted: false } as Awaited<ReturnType<typeof requestRecordingPermissionsAsync>>);
  const hook = await renderHook(() => useSession(), { wrapper: SessionProvider });
  await act(async () => { expect(await hook.result.current.startConversation(setup)).toBe(false); });
  expect(mockSocket.end).toHaveBeenCalled();
  expect(mockSocket.startAudio).not.toHaveBeenCalled();
  expect(hook.result.current.starting).toBe(false);
  expect(hook.result.current.state.interventionOrder).toEqual([]);
  await hook.unmount();
});

test('ending while permission is pending ignores the late result and stale events', async () => {
  let grant!: (value: Awaited<ReturnType<typeof requestRecordingPermissionsAsync>>) => void;
  jest.mocked(requestRecordingPermissionsAsync).mockImplementation(() => new Promise((resolve) => { grant = resolve; }));
  const hook = await renderHook(() => useSession(), { wrapper: SessionProvider });
  let pending!: Promise<boolean>;
  await act(async () => { pending = hook.result.current.startConversation(setup); });
  await waitFor(() => expect(requestRecordingPermissionsAsync).toHaveBeenCalled());
  await act(async () => {
    hook.result.current.endConversation();
    grant({ granted: true } as Awaited<ReturnType<typeof requestRecordingPermissionsAsync>>);
    expect(await pending).toBe(false);
    mockSocketOptions.onEvent({
      type: 'session.ready', protocol_version: 1, sequence: 0,
      session_id: '00000000-0000-4000-8000-000000000001',
      resume_token: 'r'.repeat(43), resumed: false,
    });
  });
  expect(mockSocket.startAudio).not.toHaveBeenCalled();
  expect(hook.result.current.state.sessionId).toBeNull();
  await hook.unmount();
});
