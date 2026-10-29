import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { SEED_12345_DRAWS_19, SEED_12345_FINAL_STATE, SEED_1_OUTPUTS } from '../generator/golden';

// Runs the exact xorshift32_v1 source in each browser engine and compares it with the Node golden vectors.
const source = stripTypeScriptTypes(readFileSync('src/application/piece-source/xorshift32.ts', 'utf8')).replace(/^export /gm, '');

test('golden vectors and bounded draws match Node in this engine', async ({ page, browserName }) => {
  await page.goto('about:blank');
  const result = await page.evaluate((code) => {
    const { xorshift32, drawBounded } = new Function(`${code}; return { xorshift32, drawBounded };`)() as {
      xorshift32: (s: number) => number;
      drawBounded: (s: number, b: number) => { value: number; state: number };
    };
    let s = 1;
    const outputs = [0, 1, 2].map(() => (s = xorshift32(s)));
    let state = 12345;
    const draws: number[] = [];
    for (let i = 0; i < 24; i++) {
      const d = drawBounded(state, 19);
      draws.push(d.value);
      state = d.state;
    }
    return { outputs, draws, state, ua: navigator.userAgent };
  }, source);
  console.log(`[${browserName}] ${result.ua}`);
  expect(result.outputs).toEqual(SEED_1_OUTPUTS);
  expect(result.draws).toEqual(SEED_12345_DRAWS_19);
  expect(result.state).toBe(SEED_12345_FINAL_STATE);
});

test.describe('recorded session replay (T11)', () => {
  let bundle = '';
  test.beforeAll(async () => {
    // Bundle the real runner + application + domain code for the browser, exactly as Node runs it.
    const { build } = await import('vite');
    const out = await build({
      configFile: false,
      logLevel: 'silent',
      build: { write: false, minify: false, lib: { entry: 'tools/replay/runner.ts', formats: ['iife'], name: 'Replay' } },
    });
    const result = Array.isArray(out) ? out[0]! : out;
    if (!('output' in result)) throw new Error('unexpected Vite build result');
    bundle = result.output[0].code;
  });

  test('the recorded sequence gives identical states in this engine and in Node', async ({ page, browserName }) => {
    const recorded = JSON.parse(readFileSync('tests/property/fixtures/recorded-seed-2026.json', 'utf8'));
    const rules = JSON.parse(readFileSync('public/content/releases/1.1.0/rules.json', 'utf8'));
    const pieces = JSON.parse(readFileSync('public/content/releases/1.1.0/pieces.json', 'utf8'));
    await page.goto('about:blank');
    await page.addScriptTag({ content: bundle });
    const trace = await page.evaluate(
      ({ recorded, rules, pieces }) => {
        const R = (window as unknown as { Replay: typeof import('../../tools/replay/runner') }).Replay;
        return R.replay(R.parseGameplay(rules, pieces).config, recorded.seed, recorded.commands).trace;
      },
      { recorded, rules, pieces },
    );
    const sha = createHash('sha256').update(trace.join('\n')).digest('hex');
    console.log(`[${browserName}] recorded seed ${recorded.seed}: ${trace.length - 1} moves, trace sha256 ${sha}`);
    expect(trace).toHaveLength(recorded.expected.moves + 1);
    expect(sha).toBe(recorded.expected.traceSha256);
  });
});
