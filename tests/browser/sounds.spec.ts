import { expect, test } from '@playwright/test';
import { release } from './helpers';

// Every shipped effect decodes in this engine. Runs in Chromium and in Playwright's Firefox and WebKit builds
// (not real Safari or devices). No gesture is needed: an OfflineAudioContext never plays out loud.
test('the shipped sound effects decode', async ({ page }) => {
  const hasWebAudio = async () => page.evaluate(() => typeof AudioContext === 'function' || typeof OfflineAudioContext === 'function');
  const effects = Object.entries(release('audio.json').effects as Record<string, string>);
  await page.goto('http://localhost:4173/');
  test.skip(!(await hasWebAudio()), 'this engine build has no Web Audio (Playwright WebKit on Windows); recorded NOT RUN');
  const durations = await page.evaluate(async (effects) => {
    // Playwright's Windows WebKit build has no OfflineAudioContext; a suspended AudioContext decodes too.
    const context = typeof OfflineAudioContext === 'function' ? new OfflineAudioContext(1, 44100, 44100) : new AudioContext();
    const out: Record<string, number> = {};
    for (const [name, path] of effects) {
      const bytes = await (await fetch(`content/releases/1.1.0/${path}`)).arrayBuffer();
      out[name] = Math.round((await context.decodeAudioData(bytes)).duration * 100) / 100;
    }
    return out;
  }, effects);
  expect(durations).toEqual({ pick: 0.07, place: 0.14, clear: 0.68, invalid: 0.2, game_over: 1.04 });
});
