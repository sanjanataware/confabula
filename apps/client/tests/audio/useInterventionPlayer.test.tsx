import * as Speech from 'expo-speech';

import {
  DeviceSpeechPlayer,
  InterventionPlayerController,
  type PlayerPort,
  type PlayerStatus,
} from '../../src/audio/useInterventionPlayer';

jest.mock('expo-audio', () => ({ createAudioPlayer: jest.fn() }));
jest.mock('expo-speech', () => ({ speak: jest.fn(), stop: jest.fn(async () => undefined) }));

class FakePlayer implements PlayerPort {
  currentStatus: PlayerStatus = { isLoaded: false, didJustFinish: false, error: null };
  listener: ((status: PlayerStatus) => void) | null = null;
  play = jest.fn();
  pause = jest.fn();
  remove = jest.fn();
  unsubscribe = jest.fn();
  addListener(_: 'playbackStatusUpdate', listener: (status: PlayerStatus) => void) {
    this.listener = listener;
    return { remove: this.unsubscribe };
  }
  update(update: Partial<PlayerStatus>) {
    this.currentStatus = { ...this.currentStatus, ...update };
    this.listener?.(this.currentStatus);
  }
}

function harness() {
  const players: FakePlayer[] = [];
  const callbacks = {
    onStarted: jest.fn(), onEnded: jest.fn(), onInterrupted: jest.fn(), onFailure: jest.fn(),
  };
  const controller = new InterventionPlayerController(() => callbacks, () => {
    const player = new FakePlayer();
    players.push(player);
    return player;
  });
  return { controller, players, callbacks };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test('loads before reporting started and reports started before play', () => {
  const ctx = harness();
  const order: string[] = [];
  ctx.callbacks.onStarted.mockImplementation(() => order.push('started'));
  ctx.controller.requestAutomatic('a', 'audio_url', 'supermercado', 'es', 'https://localhost/audio-a');
  ctx.players[0].play.mockImplementation(() => order.push('play'));
  expect(ctx.callbacks.onStarted).not.toHaveBeenCalled();
  ctx.players[0].update({ isLoaded: true });
  expect(order).toEqual(['started', 'play']);
  ctx.controller.stopAll();
});

test('queues without overlap and releases the previous player before starting the next', () => {
  const ctx = harness();
  ctx.controller.requestAutomatic('a', 'audio_url', 'supermercado', 'es', 'https://localhost/audio-a');
  ctx.controller.requestAutomatic('b', 'audio_url', 'mercado', 'es', 'https://localhost/audio-b');
  expect(ctx.players).toHaveLength(1);
  ctx.players[0].update({ isLoaded: true });
  ctx.players[0].update({ didJustFinish: true });
  expect(ctx.players[0].remove).toHaveBeenCalledTimes(1);
  expect(ctx.players).toHaveLength(2);
  expect(ctx.callbacks.onEnded).toHaveBeenCalledWith(expect.objectContaining({ interventionId: 'a' }));
  ctx.controller.stopAll();
});

test('stop is immediate, idempotent, and retains a manual replay path', () => {
  const ctx = harness();
  ctx.controller.requestAutomatic('a', 'audio_url', 'supermercado', 'es', 'https://localhost/audio-a');
  ctx.players[0].update({ isLoaded: true });
  ctx.controller.stopRequested('a');
  ctx.controller.stopRequested('a');
  expect(ctx.players[0].pause).toHaveBeenCalledTimes(1);
  expect(ctx.players[0].remove).toHaveBeenCalledTimes(1);
  expect(ctx.callbacks.onInterrupted).toHaveBeenCalledTimes(1);
  ctx.controller.replay('a', 'audio_url', 'supermercado', 'es', 'https://localhost/audio-a');
  ctx.players[1].update({ isLoaded: true });
  expect(ctx.callbacks.onStarted).toHaveBeenLastCalledWith(expect.objectContaining({ manual: true }));
  ctx.controller.stopAll();
  ctx.controller.stopAll();
  expect(ctx.players[1].remove).toHaveBeenCalledTimes(1);
});

test('load or decode failure interrupts once without surfacing provider prose', () => {
  const ctx = harness();
  ctx.controller.requestAutomatic('a', 'audio_url', 'supermercado', 'es', 'https://localhost/audio-a');
  ctx.players[0].update({ error: 'private-provider-detail' });
  expect(ctx.callbacks.onFailure).toHaveBeenCalledTimes(1);
  expect(ctx.callbacks.onInterrupted).toHaveBeenCalledTimes(1);
  expect(ctx.callbacks.onStarted).not.toHaveBeenCalled();
  expect(JSON.stringify(ctx.callbacks.onFailure.mock.calls)).not.toContain('private-provider-detail');
  ctx.controller.stopAll();
});

test('bounded loading does not acknowledge a clip that never loads', () => {
  const ctx = harness();
  ctx.controller.requestAutomatic('a', 'audio_url', 'supermercado', 'es', 'https://localhost/audio-a');
  jest.advanceTimersByTime(1800);
  expect(ctx.callbacks.onFailure).toHaveBeenCalledTimes(1);
  expect(ctx.callbacks.onStarted).not.toHaveBeenCalled();
  expect(ctx.players[0].remove).toHaveBeenCalledTimes(1);
});

test('device speech uses translated text and language and reports completion', () => {
  const player = new DeviceSpeechPlayer('supermercado', 'es');
  const listener = jest.fn();
  player.addListener('playbackStatusUpdate', listener);
  player.play();
  expect(Speech.speak).toHaveBeenCalledWith(
    'supermercado',
    expect.objectContaining({ language: 'es' }),
  );
  const options = jest.mocked(Speech.speak).mock.calls[0][1];
  options?.onDone?.();
  expect(listener).toHaveBeenCalledWith(
    expect.objectContaining({ didJustFinish: true }),
  );
  player.pause();
  expect(Speech.stop).toHaveBeenCalled();
});
