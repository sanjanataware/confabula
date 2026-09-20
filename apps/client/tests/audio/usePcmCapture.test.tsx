import { act, renderHook } from '@testing-library/react-native';
import { requestRecordingPermissionsAsync } from 'expo-audio';

import { usePcmCapture } from '../../src/audio/usePcmCapture';

type BufferCallback = (buffer: { data: ArrayBuffer; channels: number; sampleRate: number }) => void;
let mockOnBuffer: BufferCallback;
const mockStream = { start: jest.fn(async () => undefined), stop: jest.fn() };
jest.mock('expo-audio', () => ({
  requestRecordingPermissionsAsync: jest.fn(),
  setAudioModeAsync: jest.fn(async () => undefined),
  useAudioStream: (options: { onBuffer: BufferCallback }) => {
    mockOnBuffer = options.onBuffer;
    return { stream: mockStream, isStreaming: false };
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(requestRecordingPermissionsAsync).mockResolvedValue({
    granted: true, status: 'granted', canAskAgain: true, expires: 'never',
  } as Awaited<ReturnType<typeof requestRecordingPermissionsAsync>>);
});

test('permission is requested only by explicit start and denial never starts capture', async () => {
  jest.mocked(requestRecordingPermissionsAsync).mockResolvedValue({ granted: false } as Awaited<ReturnType<typeof requestRecordingPermissionsAsync>>);
  const hook = await renderHook(() => usePcmCapture({ onFrame: jest.fn() }));
  expect(requestRecordingPermissionsAsync).not.toHaveBeenCalled();
  await act(async () => { expect(await hook.result.current.start()).toBe(false); });
  expect(mockStream.start).not.toHaveBeenCalled();
  expect(hook.result.current.state).toBe('permission_denied');
  await hook.unmount();
});

test('emits exact little-endian frames and releases capture on stop', async () => {
  const onFrame = jest.fn();
  const hook = await renderHook(() => usePcmCapture({ onFrame }));
  await act(async () => { await hook.result.current.start(true); });
  await act(async () => {
    mockOnBuffer({ data: new ArrayBuffer(3840), channels: 1, sampleRate: 24000 });
  });
  expect(onFrame).toHaveBeenCalledTimes(1);
  expect(onFrame.mock.calls[0][0].byteLength).toBe(3840);
  expect(hook.result.current.diagnostics.emittedFrameCount).toBe(1);
  await act(async () => hook.result.current.stop());
  expect(mockStream.stop).toHaveBeenCalled();
  await hook.unmount();
});

test('publishes capture diagnostics at most once per second after the first frame', async () => {
  let now = 0;
  const clock = jest.spyOn(Date, 'now').mockImplementation(() => now);
  const hook = await renderHook(() => usePcmCapture({ onFrame: jest.fn() }));
  await act(async () => { await hook.result.current.start(true); });
  await act(async () => mockOnBuffer({ data: new ArrayBuffer(3840), channels: 1, sampleRate: 24000 }));
  expect(hook.result.current.diagnostics.emittedFrameCount).toBe(1);
  now = 100;
  await act(async () => mockOnBuffer({ data: new ArrayBuffer(3840), channels: 1, sampleRate: 24000 }));
  expect(hook.result.current.diagnostics.emittedFrameCount).toBe(1);
  now = 1100;
  await act(async () => mockOnBuffer({ data: new ArrayBuffer(3840), channels: 1, sampleRate: 24000 }));
  expect(hook.result.current.diagnostics.emittedFrameCount).toBe(3);
  clock.mockRestore();
  await hook.unmount();
});

test('format failures stop the actual stream instead of leaving the microphone open', async () => {
  const hook = await renderHook(() => usePcmCapture({ onFrame: jest.fn() }));
  await act(async () => { await hook.result.current.start(true); });
  await act(async () => mockOnBuffer({ data: new ArrayBuffer(3), channels: 1, sampleRate: 24000 }));
  expect(mockStream.stop).toHaveBeenCalled();
  expect(hook.result.current.state).toBe('unsupported_audio_format');
  await hook.unmount();
});

test('stop during a permission prompt cannot start a late microphone capture', async () => {
  let grant!: (value: Awaited<ReturnType<typeof requestRecordingPermissionsAsync>>) => void;
  jest.mocked(requestRecordingPermissionsAsync).mockImplementation(() => new Promise((resolve) => { grant = resolve; }));
  const hook = await renderHook(() => usePcmCapture({ onFrame: jest.fn() }));
  await act(async () => {
    const start = hook.result.current.start();
    hook.result.current.stop();
    grant({ granted: true } as Awaited<ReturnType<typeof requestRecordingPermissionsAsync>>);
    expect(await start).toBe(false);
  });
  expect(mockStream.start).not.toHaveBeenCalled();
  await hook.unmount();
});
