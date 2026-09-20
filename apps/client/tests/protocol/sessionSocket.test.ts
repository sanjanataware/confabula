import type { ServerEvent } from '../../src/protocol/generated';
import { SessionSocket, type WebSocketLike } from '../../src/protocol/sessionSocket';

class FakeSocket implements WebSocketLike {
  binaryType = '';
  bufferedAmount = 0;
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code?: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  sent: (string | ArrayBuffer)[] = [];

  send(data: string | ArrayBuffer): void { this.sent.push(data); }
  close(code?: number): void {
    this.readyState = 3;
    this.onclose?.({ code });
  }
  open(): void { this.readyState = 1; this.onopen?.(); }
  message(value: object): void { this.onmessage?.({ data: JSON.stringify(value) }); }
}

const sessionId = '00000000-0000-4000-8000-000000000001';
const setup = {
  backendBaseUrl: 'https://localhost:8444',
  pairingToken: 'p'.repeat(43),
  config: {
    mode: 'learner_fluent' as const,
    learning_language: 'es',
    learner1_native_language: 'en',
    learner2_native_language: null,
  },
};
const ready = (sequence = 0, resumed = false) => ({
  type: 'session.ready', protocol_version: 1, session_id: sessionId,
  sequence, resume_token: 'r'.repeat(43), resumed,
});
const status = (sequence: number) => ({
  type: 'session.status', protocol_version: 1, session_id: sessionId,
  sequence, connection_state: 'active', activities: ['listening'],
});

function harness() {
  const sockets: FakeSocket[] = [];
  const events: ServerEvent[] = [];
  const lost = jest.fn();
  const urls: string[] = [];
  const client = new SessionSocket({
    createWebSocket: (url) => {
      urls.push(url);
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    onEvent: (event) => events.push(event),
    onConnectionLost: lost,
  });
  return { client, sockets, events, lost, urls };
}

async function started() {
  const ctx = harness();
  const pending = ctx.client.start(setup);
  ctx.sockets[0].open();
  ctx.sockets[0].message(ready());
  await pending;
  return ctx;
}

async function active() {
  const ctx = await started();
  const pending = ctx.client.waitForActive();
  ctx.client.sendControl({ type: 'audio.start', protocol_version: 1 });
  ctx.sockets[0].message(status(1));
  await pending;
  return ctx;
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test('pairs only in the first JSON body and waits for active before sending audio', async () => {
  const ctx = await started();
  expect(ctx.urls).toEqual(['wss://localhost:8444/v1/session']);
  expect(JSON.parse(ctx.sockets[0].sent[0] as string)).toMatchObject({
    type: 'session.start', pairing_token: setup.pairingToken,
  });
  expect(() => ctx.client.sendAudio(new ArrayBuffer(3840))).toThrow();
  const pending = ctx.client.waitForActive();
  ctx.client.sendControl({ type: 'audio.start', protocol_version: 1 });
  ctx.sockets[0].message(status(1));
  await pending;
  const frame = new ArrayBuffer(3840);
  ctx.client.sendAudio(frame);
  expect(ctx.sockets[0].sent.at(-1)).toBe(frame);
  expect(() => ctx.client.sendAudio(new ArrayBuffer(10))).toThrow();
  ctx.client.end();
});

test('resume replays in order and ignores obsolete socket callbacks', async () => {
  const ctx = await active();
  ctx.sockets[0].close(1006);
  expect(() => ctx.client.sendAudio(new ArrayBuffer(3840))).toThrow();
  const resumed = ctx.client.resume();
  ctx.sockets[1].open();
  expect(JSON.parse(ctx.sockets[1].sent[0] as string)).toMatchObject({
    type: 'session.resume', last_sequence: 1,
  });
  ctx.sockets[0].onclose?.({ code: 1006 });
  ctx.sockets[0].message(status(999));
  ctx.sockets[1].message(status(2));
  ctx.sockets[1].message(status(2));
  expect(() => ctx.client.sendAudio(new ArrayBuffer(3840))).toThrow();
  ctx.sockets[1].message(ready(3, true));
  await resumed;
  expect(ctx.events.map((event) => event.sequence)).toEqual([0, 1, 2, 3]);
  expect(ctx.lost).toHaveBeenCalledTimes(1);
  const acknowledged = ctx.client.waitForActive();
  ctx.client.sendControl({ type: 'audio.start', protocol_version: 1 });
  ctx.sockets[1].message(status(4));
  await acknowledged;
  ctx.client.sendAudio(new ArrayBuffer(3840));
  ctx.client.end();
});

test('end invalidates late events and drops all in-memory credentials', async () => {
  const ctx = await active();
  const count = ctx.events.length;
  ctx.client.end();
  ctx.sockets[0].message(status(2));
  expect(ctx.events).toHaveLength(count);
  expect(ctx.client.credentials).toBeNull();
  expect(ctx.lost).not.toHaveBeenCalled();
});

test('backpressure stops capture without dropping or buffering more frames', async () => {
  const ctx = await active();
  const sent = ctx.sockets[0].sent.length;
  ctx.sockets[0].bufferedAmount = 96_001;
  expect(() => ctx.client.sendAudio(new ArrayBuffer(3840))).toThrow();
  expect(ctx.sockets[0].sent).toHaveLength(sent);
  expect(ctx.lost).toHaveBeenCalledWith('connection_too_slow');
  expect(() => ctx.client.sendAudio(new ArrayBuffer(3840))).toThrow();
  ctx.client.end();
});

test.each([
  () => '{invalid',
  () => JSON.stringify({ ...status(2), protocol_version: 2 }),
  () => JSON.stringify({ ...status(2), session_id: '00000000-0000-4000-8000-000000000099' }),
  () => JSON.stringify(status(4)),
])('rejects malformed, future-version, wrong-session, or gapped events', async (payload) => {
  const ctx = await active();
  ctx.sockets[0].onmessage?.({ data: payload() });
  expect(ctx.lost).toHaveBeenCalledWith('protocol_error');
  ctx.client.end();
});

test('connection readiness is bounded rather than hanging indefinitely', async () => {
  const ctx = harness();
  const pending = ctx.client.start(setup);
  const rejected = expect(pending).rejects.toThrow('connection_timeout');
  jest.advanceTimersByTime(5000);
  await rejected;
  expect(ctx.lost).toHaveBeenCalledWith('connection_timeout');
  ctx.client.end();
});

test('resume deadline is not reset after a failed connection', async () => {
  const ctx = await active();
  ctx.sockets[0].close(1006);
  jest.advanceTimersByTime(15_000);
  await expect(ctx.client.resume()).rejects.toThrow(/resume/i);
  expect(ctx.sockets).toHaveLength(1);
  ctx.client.end();
});

test('pairing rejection is reported before an active session can exist', async () => {
  const ctx = harness();
  const pending = ctx.client.start(setup);
  const rejected = expect(pending).rejects.toThrow('pairing_failed');
  ctx.sockets[0].open();
  ctx.sockets[0].close(4401);
  await rejected;
  expect(ctx.client.credentials).toBeNull();
  ctx.client.end();
});
