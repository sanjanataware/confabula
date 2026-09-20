import { createAudioPlayer } from 'expo-audio';
import * as Speech from 'expo-speech';
import { useEffect, useRef } from 'react';

export type PlaybackItem = {
  interventionId: string;
  playbackKind: 'audio_url' | 'device_speech';
  audioUrl?: string;
  text: string;
  language: string;
  manual: boolean;
};
export type PlayerStatus = { isLoaded: boolean; didJustFinish: boolean; error: string | null };
export interface PlayerPort {
  currentStatus: PlayerStatus;
  play(): void;
  pause(): void;
  remove(): void;
  addListener(event: 'playbackStatusUpdate', listener: (status: PlayerStatus) => void): { remove(): void };
}
export type InterventionPlayerOptions = {
  onStarted: (item: PlaybackItem) => boolean | void;
  onEnded: (item: PlaybackItem) => void;
  onInterrupted: (item: PlaybackItem) => void;
  onFailure?: (item: PlaybackItem) => void;
};
type ActivePlayback = {
  item: PlaybackItem;
  player: PlayerPort;
  subscription: { remove(): void } | null;
  timer: ReturnType<typeof setTimeout> | null;
  started: boolean;
};

export class DeviceSpeechPlayer implements PlayerPort {
  currentStatus: PlayerStatus = { isLoaded: true, didJustFinish: false, error: null };
  private listener: ((status: PlayerStatus) => void) | null = null;

  constructor(private readonly text: string, private readonly language: string) {}

  play(): void {
    Speech.speak(this.text, {
      language: this.language,
      rate: 0.95,
      useApplicationAudioSession: false,
      onDone: () => this.update({ didJustFinish: true }),
      onStopped: () => this.update({ error: "device_speech_stopped" }),
      onError: () => this.update({ error: "device_speech_failed" }),
    });
  }

  pause(): void {
    void Speech.stop();
  }

  remove(): void {
    this.listener = null;
  }

  addListener(
    event: 'playbackStatusUpdate',
    listener: (status: PlayerStatus) => void,
  ): { remove(): void } {
    this.listener = listener;
    return { remove: () => { this.listener = null; } };
  }

  private update(update: Partial<PlayerStatus>): void {
    this.currentStatus = { ...this.currentStatus, ...update };
    this.listener?.(this.currentStatus);
  }
}

export class InterventionPlayerController {
  private current: ActivePlayback | null = null;
  private queue: PlaybackItem[] = [];

  constructor(
    private readonly callbacks: () => InterventionPlayerOptions,
    private readonly createPlayer: (item: PlaybackItem) => PlayerPort,
  ) {}

  requestAutomatic = (
    interventionId: string,
    playbackKind: PlaybackItem['playbackKind'],
    text: string,
    language: string,
    audioUrl?: string,
  ): void => {
    this.enqueue({ interventionId, playbackKind, audioUrl, text, language, manual: false });
  };

  replay = (
    interventionId: string,
    playbackKind: PlaybackItem['playbackKind'],
    text: string,
    language: string,
    audioUrl?: string,
  ): void => {
    this.enqueue({ interventionId, playbackKind, audioUrl, text, language, manual: true });
  };

  stopRequested = (interventionId: string): void => {
    const removed = this.queue.filter((item) => item.interventionId === interventionId);
    this.queue = this.queue.filter((item) => item.interventionId !== interventionId);
    for (const item of removed) this.callbacks().onInterrupted(item);
    if (this.current?.item.interventionId === interventionId) this.finish('interrupted');
  };

  stopAll = (): void => {
    const queued = this.queue;
    this.queue = [];
    for (const item of queued) this.callbacks().onInterrupted(item);
    if (this.current) this.finish('interrupted');
  };

  private enqueue(item: PlaybackItem): void {
    if (
      this.current?.item.interventionId === item.interventionId ||
      this.queue.some((queued) => queued.interventionId === item.interventionId)
    ) return;
    this.queue.push(item);
    this.next();
  }

  private next(): void {
    if (this.current) return;
    const item = this.queue.shift();
    if (!item) return;
    let player: PlayerPort;
    try {
      player = this.createPlayer(item);
    } catch {
      this.callbacks().onFailure?.(item);
      this.callbacks().onInterrupted(item);
      this.next();
      return;
    }
    const active: ActivePlayback = { item, player, subscription: null, timer: null, started: false };
    this.current = active;
    active.timer = setTimeout(() => {
      if (this.current === active && !active.started) this.finish('failed');
    }, 1800);
    active.subscription = player.addListener('playbackStatusUpdate', (status) => this.update(active, status));
    this.update(active, player.currentStatus);
  }

  private update(active: ActivePlayback, status: PlayerStatus): void {
    if (this.current !== active) return;
    if (status.error) {
      this.finish('failed');
    } else if (status.didJustFinish && active.started) {
      this.finish('ended');
    } else if (status.isLoaded && !active.started) {
      active.started = true;
      if (active.timer) clearTimeout(active.timer);
      active.timer = null;
      try {
        if (this.callbacks().onStarted(active.item) === false) {
          this.finish('interrupted');
          return;
        }
        active.player.play();
      } catch {
        this.finish('failed');
      }
    }
  }

  private finish(reason: 'ended' | 'interrupted' | 'failed'): void {
    const active = this.current;
    if (!active) return;
    this.current = null;
    if (active.timer) clearTimeout(active.timer);
    active.subscription?.remove();
    try {
      active.player.pause();
    } finally {
      active.player.remove();
    }
    if (reason === 'ended') this.callbacks().onEnded(active.item);
    else {
      if (reason === 'failed') this.callbacks().onFailure?.(active.item);
      this.callbacks().onInterrupted(active.item);
    }
    this.next();
  }
}

export function useInterventionPlayer(options: InterventionPlayerOptions) {
  const callbacks = useRef(options);
  callbacks.current = options;
  const controller = useRef<InterventionPlayerController | null>(null);
  controller.current ??= new InterventionPlayerController(
    () => callbacks.current,
    (item) => {
      if (item.playbackKind === 'device_speech') {
        return new DeviceSpeechPlayer(item.text, item.language);
      }
      if (!item.audioUrl) throw new Error('audio URL is required');
      return createAudioPlayer(
        { uri: item.audioUrl },
        { updateInterval: 100, downloadFirst: false },
      );
    },
  );
  const current = controller.current;
  useEffect(() => () => current.stopAll(), [current]);
  return current;
}
