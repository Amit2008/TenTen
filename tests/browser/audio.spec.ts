import { expect, test, type Page } from '@playwright/test';
import { ready } from './helpers';

// Test fixtures, not final assets: sine tones generated here and served by route interception.
function wav(seconds: number, hz = 440): Buffer {
  const rate = 8000;
  const n = Math.round(rate * seconds);
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + n * 2, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); // PCM
  b.writeUInt16LE(1, 22); // mono
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin((2 * Math.PI * hz * i) / rate) * 3000), 44 + i * 2);
  return b;
}

/** Effects are told apart in the log by length. */
const EFFECTS = { pick: 0.05, place: 0.06, clear: 0.07, invalid: 0.08, game_over: 0.09 } as const;
const FILES: Record<string, Buffer> = {
  ...Object.fromEntries(Object.entries(EFFECTS).map(([name, s]) => [`${name}.wav`, wav(s, 880)])),
  'short-1.wav': wav(0.3),
  'short-2.wav': wav(0.3, 330),
  'long-a.wav': wav(8),
  'long-b.wav': wav(8, 330),
  'bad.wav': Buffer.from('this is not audio data at all'.repeat(20)),
};
const allEffects = Object.fromEntries(Object.keys(EFFECTS).map((name) => [name, `audio/${name}.wav`]));
const noEffects = Object.fromEntries(Object.keys(EFFECTS).map((name) => [name, null]));

/** Serves an audio.json naming `tracks` and `effects`, the fixture files, and logs what the page plays. */
async function withAudio(page: Page, tracks: string[], effects: Record<string, string | null>, opts: { block?: boolean } = {}) {
  await page.route('**/releases/*/audio.json', (route) =>
    route.fulfill({
      json: {
        schema_version: 1, master_volume: 0.7, music_volume: 0.3, sfx_volume: 0.7, music_tracks: tracks,
        shuffle: false, repeat_playlist: true, effects, missing_asset_policy: 'silent_with_log',
      },
    }),
  );
  await page.route('**/audio/*.wav', (route) => {
    const body = FILES[new URL(route.request().url()).pathname.split('/').pop()!];
    return body ? route.fulfill({ body, contentType: 'audio/wav' }) : route.fulfill({ status: 404 });
  });
  await page.addInitScript((block) => {
    const w = window as unknown as { audioLog: string[]; contexts: AudioContext[]; gains: GainNode[]; blockAudio: boolean };
    Object.assign(w, { audioLog: [], contexts: [], gains: [], blockAudio: block });
    const refuse = () => Promise.reject(new DOMException('Refused by test autoplay policy', 'NotAllowedError'));
    const Context = window.AudioContext;
    window.AudioContext = class extends Context {
      constructor(options?: AudioContextOptions) {
        super(options);
        w.contexts.push(this);
      }
    };
    const resume = AudioContext.prototype.resume;
    AudioContext.prototype.resume = function () {
      return w.blockAudio ? refuse() : resume.call(this);
    };
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      w.audioLog.push(`music ${this.src.split('/').pop()}`);
      return w.blockAudio ? refuse() : play.call(this);
    };
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args: Parameters<typeof start>) {
      w.audioLog.push(`effect ${this.buffer!.duration.toFixed(2)}`);
      return start.apply(this, args);
    };
    const createGain = BaseAudioContext.prototype.createGain;
    BaseAudioContext.prototype.createGain = function () {
      const gain = createGain.call(this);
      w.gains.push(gain);
      return gain;
    };
  }, !!opts.block);
}

const log = (page: Page) => page.evaluate(() => (window as unknown as { audioLog: string[] }).audioLog);
const music = async (page: Page) => (await log(page)).filter((e) => e.startsWith('music'));
const contextState = (page: Page) => page.evaluate(() => (window as unknown as { contexts: AudioContext[] }).contexts.map((c) => c.state));
const effect = (name: keyof typeof EFFECTS) => `effect ${EFFECTS[name].toFixed(2)}`;

/** Places the first tray piece at its default anchor on an empty board: slot button (focuses the board), then Enter. */
async function placeFirst(page: Page) {
  const before = await page.locator('#score').textContent();
  await page.getByRole('button', { name: /^Slot 1/ }).click();
  await expect(page.locator('#game canvas')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#score')).not.toHaveText(before!);
}

test('the shipped configuration has no audio and never creates an AudioContext', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { created: number };
    w.created = 0;
    const Context = window.AudioContext;
    window.AudioContext = class extends Context {
      constructor(options?: AudioContextOptions) {
        super(options);
        w.created++;
      }
    };
  });
  await ready(page, './');
  await page.getByRole('button', { name: 'New game' }).click();
  await placeFirst(page);
  expect(await page.evaluate(() => (window as unknown as { created: number }).created)).toBe(0);
  await expect(page.locator('#sound-button')).toBeHidden();
});

test('nothing starts before a gesture; New game starts music, and moves play effects', async ({ page }) => {
  await withAudio(page, ['audio/long-a.wav', 'audio/long-b.wav'], allEffects);
  await ready(page, './');
  await page.waitForTimeout(500);
  expect(await contextState(page)).toEqual([]);
  expect(await log(page)).toEqual([]);
  await page.getByRole('button', { name: 'New game' }).click();
  await expect.poll(() => contextState(page)).toEqual(['running']);
  await expect.poll(() => music(page)).toEqual(['music long-a.wav']);
  await expect.poll(async () => (await page.evaluate(() => performance.getEntriesByType('resource').map((r) => r.name))).filter((n) => n.endsWith('.wav')).length).toBeGreaterThanOrEqual(5);
  await placeFirst(page);
  await expect.poll(() => log(page)).toEqual(expect.arrayContaining([effect('pick'), effect('place')]));
  await expect(page.locator('#sound-button')).toBeHidden();
});

test('an autoplay refusal never blocks play, and Enable sound starts audio later', async ({ page }) => {
  await withAudio(page, ['audio/long-a.wav'], allEffects, { block: true });
  await ready(page, './');
  await page.getByRole('button', { name: 'New game' }).click();
  await expect(page.getByRole('button', { name: 'Enable sound' })).toBeVisible();
  await placeFirst(page);
  expect(await music(page)).toEqual([]);
  await page.evaluate(() => ((window as unknown as { blockAudio: boolean }).blockAudio = false));
  await page.getByRole('button', { name: 'Enable sound' }).click();
  await expect(page.getByRole('button', { name: 'Enable sound' })).toBeHidden();
  await expect.poll(() => music(page)).toEqual(['music long-a.wav']);
});

test('missing and undecodable audio is skipped a bounded number of times and play goes on silently', async ({ page }) => {
  const warnings: string[] = [];
  page.on('console', (m) => m.type() === 'warning' && warnings.push(m.text()));
  await withAudio(page, ['audio/missing.wav', 'audio/bad.wav'], { ...noEffects, place: 'audio/missing-effect.wav', pick: 'audio/bad.wav' });
  await ready(page, './');
  await page.getByRole('button', { name: 'New game' }).click();
  await expect.poll(() => warnings.filter((w) => /could not be played|is unavailable/.test(w)).length).toBe(4);
  await page.waitForTimeout(1000); // a retry loop would keep adding attempts
  expect(await music(page)).toEqual(['music missing.wav', 'music bad.wav']);
  await placeFirst(page);
  expect((await log(page)).filter((e) => e.startsWith('effect'))).toEqual([]);
  await expect(page.locator('#sound-button')).toBeHidden();
});

test('pause, a hidden tab and rapid restarts never advance the playlist', async ({ page }) => {
  await withAudio(page, ['audio/long-a.wav', 'audio/long-b.wav'], noEffects);
  await ready(page, './');
  await page.getByRole('button', { name: 'New game' }).click();
  await expect.poll(() => music(page)).toEqual(['music long-a.wav']);

  await page.getByRole('button', { name: 'Pause' }).click();
  await expect.poll(() => contextState(page)).toEqual(['suspended']);
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect.poll(() => contextState(page)).toEqual(['running']);

  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => contextState(page)).toEqual(['suspended']);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.getByRole('button', { name: 'Resume' }).click();

  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: 'Pause' }).click();
    await page.getByRole('dialog', { name: 'Paused' }).getByRole('button', { name: 'Restart' }).click();
    await page.getByRole('button', { name: 'Start new game' }).click();
  }
  await expect.poll(() => contextState(page)).toEqual(['running']);
  const played = await music(page);
  expect(played.length).toBeGreaterThan(1);
  expect(new Set(played)).toEqual(new Set(['music long-a.wav']));
});

test('a finished track advances the playlist, and the volume settings drive the gains', async ({ page }) => {
  await withAudio(page, ['audio/short-1.wav', 'audio/short-2.wav'], noEffects);
  await ready(page, './');
  await page.getByRole('button', { name: 'New game' }).click();
  // Tracks keep advancing while this polls; the first three show the order.
  await expect.poll(async () => (await music(page)).slice(0, 3), { timeout: 10_000 }).toEqual(['music short-1.wav', 'music short-2.wav', 'music short-1.wav']);

  const gains = () => page.evaluate(() => (window as unknown as { gains: GainNode[] }).gains.map((g) => Math.round(g.gain.value * 100)));
  expect(await gains()).toEqual([70, 30, 70]); // master, music, effects from audio.json
  await page.getByRole('button', { name: 'Pause' }).click();
  await page.getByRole('dialog', { name: 'Paused' }).getByRole('button', { name: 'Settings' }).click();
  await page.getByLabel('Master volume').fill('0');
  await page.getByLabel('Music volume').fill('55');
  expect(await gains()).toEqual([0, 55, 70]);
});
