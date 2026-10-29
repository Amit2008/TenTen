import { expect, test } from '@playwright/test';
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
