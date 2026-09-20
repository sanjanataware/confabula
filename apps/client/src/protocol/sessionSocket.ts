import { FRAME_BYTES } from '../audio/pcm';
import { normalizeBackendBaseUrl } from '../services/capabilities';
import type { ClientMessage, ServerEvent, SessionConfig, SessionReady } from './generated';
import { parseServerEvent } from './parse';

export const MAX_BUFFERED_AUDIO_BYTES = 96_000;
export type SessionControl = Exclude<ClientMessage, { type: 'session.start' | 'session.resume' }>;

export type SessionCredentials = {
  pairingToken: string;
  sessionId: string;
  resumeToken: string;
  lastSequence: number;
};
export type SessionStartOptions = {
  backendBaseUrl: string;
  pairingToken: string;
  config: SessionConfig;
};
export type SocketFailure =
  | 'connection_lost' | 'connection_too_slow' | 'connection_timeout'
  | 'protocol_error' | 'resume_unavailable' | 'pairing_failed' | 'provider_unavailable';

export interface WebSocketLike {
  binaryType: string;
  bufferedAmount: number;
  readyState: number;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code?: number }) => void) | null;
  onerror: (() => void) | null;
  send(data: string | ArrayBuffer): void;
  close(code?: number): void;
}
export type SessionSocketOptions = {
  createWebSocket?: (url: string) => WebSocketLike;
  onEvent: (event: ServerEvent) => void;
  onConnectionLost: (failure: SocketFailure) => void;
};
type Pending<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
};

export class SessionSocket {
  private readonly createWebSocket: (url: string) => WebSocketLike;
  private readonly onEvent: (event: ServerEvent) => void;
  private readonly onConnectionLost: (failure: SocketFailure) => void;
  private socket: WebSocketLike | null = null;
  private generation = 0;
  private backendBaseUrl = '';
  private pairingToken = '';
  private sessionId: string | null = null;
  private resumeToken: string | null = null;
  private lastSequence = -1;
  private disconnectedAt: number | null = null;
  private resumeAttempted = false;
  private replaying = false;
  private audioActive = false;
  private audioStartSent = false;
  private readyWait: Pending<SessionReady> | null = null;
  private activeWait: Pending<void> | null = null;

  constructor(options: SessionSocketOptions) {
    this.createWebSocket = options.createWebSocket ??
      ((url) => new WebSocket(url) as unknown as WebSocketLike);
    this.onEvent = options.onEvent;
    this.onConnectionLost = options.onConnectionLost;
  }

  start(options: SessionStartOptions): Promise<SessionReady> {
    this.end();
    this.backendBaseUrl = normalizeBackendBaseUrl(options.backendBaseUrl);
    this.pairingToken = options.pairingToken;
    return this.connect({
      type: 'session.start', protocol_version: 1,
      pairing_token: options.pairingToken, config: options.config,
    }, 5000);
  }

  resume(credentials: SessionCredentials | null = this.credentials): Promise<SessionReady> {
    const remaining = this.disconnectedAt === null ? 0 : 15_000 - (Date.now() - this.disconnectedAt);
    if (!credentials || !this.backendBaseUrl || this.resumeAttempted || remaining <= 0) {
      return Promise.reject(new Error('resume_unavailable'));
    }
    this.resumeAttempted = true;
    this.replaying = true;
    this.pairingToken = credentials.pairingToken;
    this.sessionId = credentials.sessionId;
    this.resumeToken = credentials.resumeToken;
    this.lastSequence = credentials.lastSequence;
    return this.connect({
      type: 'session.resume', protocol_version: 1,
      pairing_token: credentials.pairingToken, session_id: credentials.sessionId,
      resume_token: credentials.resumeToken, last_sequence: credentials.lastSequence,
    }, remaining);
  }

  get credentials(): SessionCredentials | null {
    return this.sessionId && this.resumeToken ? {
      pairingToken: this.pairingToken, sessionId: this.sessionId,
      resumeToken: this.resumeToken, lastSequence: this.lastSequence,
    } : null;
  }

  get isActive(): boolean {
    return this.audioActive && this.socket?.readyState === 1;
  }

  waitForActive(): Promise<void> {
    if (this.isActive) return Promise.resolve();
    this.activeWait ??= this.pending<void>(12_000, 'provider_unavailable');
    return this.activeWait.promise;
  }

  startAudio(): Promise<void> {
    const waiting = this.waitForActive();
    try {
      this.sendControl({ type: 'audio.start', protocol_version: 1 });
    } catch {
      this.clearPending(new Error('connection_lost'));
    }
    return waiting;
  }

  sendAudio(frame: ArrayBuffer): void {
    if (!(frame instanceof ArrayBuffer) || frame.byteLength !== FRAME_BYTES) {
      throw new Error('invalid_audio_frame');
    }
    const socket = this.requireOpenSocket();
    if (!this.audioActive) throw new Error('audio_not_active');
    if (socket.bufferedAmount > MAX_BUFFERED_AUDIO_BYTES) {
      this.fail('connection_too_slow');
      throw new Error('connection_too_slow');
    }
    socket.send(frame);
  }

  sendControl(message: SessionControl): void {
    const socket = this.requireOpenSocket();
    if (!this.sessionId || this.replaying) throw new Error('session_not_ready');
    if (message.type === 'audio.start') {
      if (this.audioStartSent) throw new Error('audio_already_started');
      this.audioStartSent = true;
    }
    if (message.type === 'audio.stop') this.audioActive = false;
    socket.send(JSON.stringify(message));
  }

  end(): void {
    const socket = this.socket;
    this.socket = null;
    this.generation += 1;
    if (socket?.readyState === 1 && this.sessionId && !this.replaying) {
      try {
        if (this.audioStartSent) socket.send(JSON.stringify({ type: 'audio.stop', protocol_version: 1 }));
        socket.send(JSON.stringify({ type: 'session.end', protocol_version: 1 }));
      } catch {
        this.audioActive = false;
      }
    }
    socket?.close(1000);
    this.clearPending(new Error('session_ended'));
    this.forgetCredentials();
  }

  private connect(message: ClientMessage, timeoutMs: number): Promise<SessionReady> {
    const generation = ++this.generation;
    this.audioActive = false;
    this.audioStartSent = false;
    const url = new URL(this.backendBaseUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = '/v1/session';
    const socket = this.createWebSocket(url.toString());
    this.socket = socket;
    socket.binaryType = 'arraybuffer';
    const pending = this.pending<SessionReady>(timeoutMs, this.replaying ? 'resume_unavailable' : 'connection_timeout');
    this.readyWait = pending;
    socket.onopen = () => {
      if (generation === this.generation) socket.send(JSON.stringify(message));
    };
    socket.onmessage = ({ data }) => {
      if (generation === this.generation) this.handleMessage(data);
    };
    socket.onerror = () => {
      if (generation === this.generation) this.fail('connection_lost');
    };
    socket.onclose = ({ code }) => {
      if (generation !== this.generation) return;
      const failure: SocketFailure = code === 4401 ? 'pairing_failed'
        : code === 4404 ? 'resume_unavailable'
        : code === 4410 ? 'provider_unavailable' : 'connection_lost';
      this.fail(failure);
    };
    return pending.promise;
  }

  private handleMessage(raw: unknown): void {
    let event: ServerEvent;
    try {
      if (typeof raw !== 'string') throw new Error('non_text_event');
      event = parseServerEvent(raw);
    } catch {
      this.fail('protocol_error');
      return;
    }
    if (
      (this.sessionId && event.session_id !== this.sessionId) ||
      (!this.sessionId && event.type !== 'session.ready')
    ) {
      this.fail('protocol_error');
      return;
    }
    if (event.sequence <= this.lastSequence) return;
    if (event.sequence !== this.lastSequence + 1) {
      this.fail('protocol_error');
      return;
    }
    this.lastSequence = event.sequence;
    if (event.type === 'session.ready') {
      if (event.resumed !== this.replaying) {
        this.fail('protocol_error');
        return;
      }
      this.sessionId = event.session_id;
      this.resumeToken = event.resume_token;
      this.disconnectedAt = null;
      this.resumeAttempted = false;
      this.replaying = false;
      this.readyWait?.resolve(event);
      this.readyWait = null;
    }
    if (
      event.type === 'session.status' && event.connection_state === 'active' &&
      event.activities.includes('listening') && this.audioStartSent && !this.replaying
    ) {
      this.audioActive = true;
      this.activeWait?.resolve();
      this.activeWait = null;
    }
    if (event.type === 'session.degraded' && event.restart_required) {
      this.audioActive = false;
      this.activeWait?.reject(new Error('provider_unavailable'));
      this.activeWait = null;
    }
    this.onEvent(event);
    if (event.type === 'session.ended') {
      const socket = this.socket;
      this.socket = null;
      this.generation += 1;
      this.clearPending(new Error('session_ended'));
      this.forgetCredentials();
      socket?.close(1000);
    }
  }

  private pending<T>(milliseconds: number, timeoutCode: SocketFailure): Pending<T> {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    const timer = setTimeout(() => this.fail(timeoutCode), milliseconds);
    return {
      promise,
      resolve: (value) => { clearTimeout(timer); resolve(value); },
      reject: (error) => { clearTimeout(timer); reject(error); },
    };
  }

  private requireOpenSocket(): WebSocketLike {
    if (!this.socket || this.socket.readyState !== 1) throw new Error('connection_lost');
    return this.socket;
  }

  private fail(failure: SocketFailure): void {
    this.generation += 1;
    const socket = this.socket;
    this.socket = null;
    this.audioActive = false;
    this.disconnectedAt ??= Date.now();
    this.clearPending(new Error(failure));
    socket?.close(4000);
    if (failure !== 'connection_lost') this.forgetCredentials();
    this.onConnectionLost(failure);
  }

  private clearPending(error: Error): void {
    this.readyWait?.reject(error);
    this.activeWait?.reject(error);
    this.readyWait = this.activeWait = null;
  }

  private forgetCredentials(): void {
    this.pairingToken = '';
    this.backendBaseUrl = '';
    this.sessionId = this.resumeToken = null;
    this.lastSequence = -1;
    this.audioActive = this.audioStartSent = this.replaying = this.resumeAttempted = false;
    this.disconnectedAt = null;
  }
}
