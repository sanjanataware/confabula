import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const backend = 'http://127.0.0.1:8765';
const headers = { 'X-E2E-Token': 'language-coach-e2e-state' };
const pairingToken = 'e'.repeat(43);

async function state(request: APIRequestContext): Promise<Record<string, number>> {
  const response = await request.get(`${backend}/__e2e__/state`, { headers });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function control(request: APIRequestContext, action: string): Promise<void> {
  const response = await request.post(`${backend}/__e2e__/control/${action}`, { headers });
  expect(response.ok()).toBeTruthy();
}

async function auditMicrophone(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const scope = window as unknown as {
      coachTestTracks: MediaStreamTrack[];
      coachSpoken: Array<{ text: string; language: string }>;
      SpeechSynthesisUtterance: new () => SpeechSynthesisUtterance;
      speechSynthesis: SpeechSynthesis;
    };
    scope.coachTestTracks = [];
    scope.coachSpoken = [];
    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const media = await getUserMedia(constraints);
      scope.coachTestTracks.push(...media.getTracks());
      return media;
    };
    class TestUtterance {
      text = '';
      lang = '';
      rate = 1;
      pitch = 1;
      volume = 1;
      voice = null;
      onstart: ((event: Event) => void) | null = null;
      onend: ((event: Event) => void) | null = null;
      onpause: ((event: Event) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
    }
    let current: TestUtterance | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: TestUtterance });
    Object.defineProperty(window, 'speechSynthesis', { value: {
      get speaking() { return current !== null; },
      getVoices: () => [],
      speak: (utterance: TestUtterance) => {
        current = utterance;
        scope.coachSpoken.push({ text: utterance.text, language: utterance.lang });
        utterance.onstart?.(new Event('start'));
        timer = setTimeout(() => {
          if (current === utterance) {
            current = null;
            utterance.onend?.(new Event('end'));
          }
        }, 5000);
      },
      cancel: () => {
        if (timer) clearTimeout(timer);
        timer = null;
        const stopped = current;
        current = null;
        stopped?.onpause?.(new Event('pause'));
      },
      pause: () => undefined,
      resume: () => undefined,
      onvoiceschanged: null,
    }});
  });
}

async function fillSetup(page: Page, token = pairingToken): Promise<void> {
  await page.goto('/');
  await expect(page.getByText('Meta and local speech are ready.')).toBeVisible();
  await page.getByTestId('learner-1-language').selectOption('en');
  await page.getByTestId('learning-language').selectOption('es');
  await page.getByTestId('pairing-token').fill(token);
  await page.getByTestId('processing-disclosure').click();
  await expect(page.getByTestId('start-conversation')).toBeEnabled();
}

test('preview, final help, device speech, echo protection, barge-in, replay, and cleanup', async ({ page, request }) => {
  await auditMicrophone(page);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const playback: { type: string; manual: boolean; at: number }[] = [];
  let playbackKind = '';
  page.on('websocket', (socket) => {
    socket.on('framesent', ({ payload }) => {
      if (typeof payload !== 'string') return;
      const frame = JSON.parse(payload);
      if (String(frame.type).startsWith('playback.')) {
        playback.push({ type: frame.type, manual: Boolean(frame.manual), at: Date.now() });
      }
    });
    socket.on('framereceived', ({ payload }) => {
      if (typeof payload !== 'string') return;
      const frame = JSON.parse(payload);
      if (frame.type === 'intervention.audio_ready') {
        playbackKind = frame.playback_kind;
        expect(frame.audio_url).toBeNull();
      }
    });
  });
  await fillSetup(page);
  await page.getByTestId('start-conversation').click();
  await expect(page).toHaveURL(/\/conversation$/);
  await expect(page.getByText('Transcript', { exact: true })).toHaveCount(0);
  await expect(page.getByText('grocery store')).toBeVisible();
  await expect(page.getByText('supermercado')).toBeVisible();
  await expect(page.getByText('Checking…')).toBeVisible();
  await expect.poll(async () => (await state(request)).speakers).toBe(2);
  expect(playback).toEqual([]);

  const finalizedAt = Date.now();
  await control(request, 'finalize');
  await expect(page.getByRole('button', { name: 'Replay supermercado' })).toBeVisible();
  await expect.poll(() => playback.filter((event) => event.type === 'playback.started').length).toBe(1);
  expect(playback[0].at - finalizedAt).toBeGreaterThanOrEqual(600);
  expect(playback[0].manual).toBe(false);
  await expect.poll(async () => (await state(request)).playing).toBe(1);
  await expect(page.getByTestId(/^intervention-/)).toHaveCount(1);

  await control(request, 'echo');
  await expect.poll(async () => (await state(request)).transcript_turns).toBe(3);
  const afterEcho = await state(request);
  expect(afterEcho.speakers).toBe(2);
  expect(afterEcho.interventions).toBe(1);
  expect(afterEcho.playing).toBe(1);
  expect(playback.filter((event) => event.type === 'playback.interrupted')).toHaveLength(0);

  await control(request, 'barge_in');
  await expect.poll(() => playback.filter((event) => event.type === 'playback.interrupted').length).toBe(1);
  await expect(page.getByText('Playback stopped')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Replay supermercado' })).toBeVisible();
  await expect.poll(async () => (await state(request)).playing).toBe(0);
  await control(request, 'complete_human');
  await page.getByRole('button', { name: 'Replay supermercado' }).click();
  await expect.poll(() => playback.filter((event) => event.type === 'playback.started').length).toBe(2);
  expect(playback.filter((event) => event.type === 'playback.started')[1].manual).toBe(true);
  await expect.poll(() => playback.filter((event) => event.type === 'playback.ended').length, { timeout: 10_000 }).toBe(1);

  for (const viewport of [{ width: 768, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(100);
    await expect(page.getByTestId(/^intervention-/)).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }

  await page.getByRole('button', { name: 'End', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId('pairing-token')).toHaveValue('');
  await expect(page.getByTestId(/^intervention-/)).toHaveCount(0);
  await expect.poll(() => state(request)).toEqual({
    sessions: 0, transcript_turns: 0, interventions: 0, events: 0,
    audio_bytes: 0, speakers: 0, playing: 0, pcm_frames: 0,
  });
  const tracks = await page.evaluate(() =>
    (window as unknown as { coachTestTracks: MediaStreamTrack[] }).coachTestTracks.map((track) => track.readyState),
  );
  expect(tracks.length).toBeGreaterThan(0);
  expect(tracks.every((track) => track === 'ended')).toBe(true);
  expect(playbackKind).toBe('device_speech');
  const spoken = await page.evaluate(() =>
    (window as unknown as {
      coachSpoken: Array<{ text: string; language: string }>;
    }).coachSpoken,
  );
  expect(spoken).toHaveLength(2);
  expect(spoken.every((item) => item.text === 'supermercado')).toBe(true);
  expect(spoken.every((item) => item.language === 'es')).toBe(true);
  expect(pageErrors).toEqual([]);
});

test('one-click backend link imports and removes pairing before startup', async ({ page, request }) => {
  await auditMicrophone(page);
  await page.goto(`/#pair=${pairingToken}`);
  await expect(page.getByText('Meta and local speech are ready.')).toBeVisible();
  await expect(page.getByText('Secure connection details added')).toBeVisible();
  await expect(page.getByTestId('pairing-token')).toHaveCount(0);
  await expect.poll(() => new URL(page.url()).hash).toBe('');
  await page.getByTestId('learner-1-language').selectOption('en');
  await page.getByTestId('learning-language').selectOption('es');
  await page.getByTestId('processing-disclosure').click();
  await page.getByTestId('start-conversation').click();
  await expect(page).toHaveURL(/\/conversation$/);
  await expect(page.getByText('Listening for useful moments')).toBeVisible();
  await page.getByRole('button', { name: 'End', exact: true }).click();
  await expect.poll(async () => (await state(request)).sessions).toBe(0);
});

test('setup remains responsive and keyboard ordered across viewports', async ({ page }) => {
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 768, height: 900 },
    { width: 390, height: 844 },
    { width: 320, height: 700 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await expect(page.getByText('Meta and local speech are ready.')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await page.getByTestId('backend-address').focus();
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('pairing-token')).toBeFocused();
  await expect(page.getByRole('checkbox', { name: 'Acknowledge provider processing' })).toBeVisible();
});

test('invalid pairing never activates the browser microphone', async ({ page }) => {
  await auditMicrophone(page);
  await fillSetup(page, 'wrong-token-'.repeat(4));
  await page.getByTestId('start-conversation').click();
  await expect(page.getByText(/Pairing failed/)).toBeVisible();
  expect(await page.evaluate(() =>
    (window as unknown as { coachTestTracks: MediaStreamTrack[] }).coachTestTracks.length,
  )).toBe(0);
});

test('leaving the foreground stops capture and clears the session', async ({ page, request }) => {
  await auditMicrophone(page);
  await fillSetup(page);
  await page.getByTestId('start-conversation').click();
  await expect(page).toHaveURL(/\/conversation$/);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page).toHaveURL(/\/$/);
  await expect.poll(async () => (await state(request)).sessions).toBe(0);
  expect(await page.evaluate(() =>
    (window as unknown as { coachTestTracks: MediaStreamTrack[] }).coachTestTracks.every((track) => track.readyState === 'ended'),
  )).toBe(true);
});
