import { expect, test, type Browser, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createGenerator } from '../../src/application/piece-source/piece-source';
import { GameSession, startSession } from '../../src/application/session/session';
import type { Cell, SessionState } from '../../src/domain/models/types';
import { cellOrigin, logicalToClient, type ClientBox, type Point } from '../../src/presentation/views/layout';
import { BOARD, canvasBox, colorDistance, ready, rules, sample, theme, VIEWPORT } from './helpers';

// T20: whole-page input and lifecycle checks not covered by the per-feature specs (pointer, states, persistence).
const recorded = JSON.parse(readFileSync('tests/property/fixtures/recorded-seed-2026.json', 'utf8')) as {
  seed: number;
  commands: { slot: number; anchor: Cell }[];
};
const CLEAR_MOVE = 16; // zero-based: move 17 clears row 4 (see states.spec.ts)
const MOVES = CLEAR_MOVE + 3;

/** Logical state hash: the run without its identity (random session id, content hash), keys sorted so order cannot matter. */
const sorted = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, sorted(x)])) : v;
const stateHash = (s: SessionState) => createHash('sha256').update(JSON.stringify(sorted({ ...s, sessionId: '', gameplayHash: '' }))).digest('hex').slice(0, 16);

const expected: string[] = [];
const scores: number[] = [];
{
  const m = new GameSession(rules, startSession(rules, 'mirror', createGenerator(recorded.seed)));
  for (const { slot, anchor } of recorded.commands.slice(0, MOVES)) {
    const s = m.state;
    const r = m.place({ type: 'PlacePiece', sessionId: s.sessionId, expectedRevision: s.revision, instanceId: s.tray[slot]!.instanceId, anchor });
    if (!r.accepted) throw new Error('recorded command rejected');
    expected.push(stateHash(r.state));
    scores.push(r.state.score);
  }
}

const cellClient = ([x, y]: Cell, box: ClientBox): Point => {
  const [left, top] = cellOrigin(BOARD, [x, y]);
  return logicalToClient([left + BOARD.pitch / 2, top + BOARD.pitch / 2], box, VIEWPORT);
};
const gameState = (page: Page) => page.locator('#game').getAttribute('data-state');

/** The stored run, read through a separate connection. */
const storedRun = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<SessionState>((resolve, reject) => {
        const r = indexedDB.open('line-garden');
        r.onerror = () => reject(r.error);
        r.onsuccess = () => {
          const get = r.result.transaction('saves').objectStore('saves').get('current');
          get.onsuccess = () => (r.result.close(), resolve(get.result.active));
        };
      }),
  );

async function place(page: Page, box: ClientBox, i: number) {
  const { slot, anchor } = recorded.commands[i]!;
  await page.getByRole('button', { name: new RegExp(`^Slot ${slot + 1}`) }).click();
  await page.mouse.click(...cellClient(anchor, box));
}

/**
 * Replaces requestAnimationFrame with a fixed-rate frame clock, so the whole page (Pixi ticker included) renders at
 * `fps`. Like real rAF, every callback queued before a frame runs in that frame with one timestamp.
 */
function frameRate(fps: number) {
  const w = window as unknown as { frames: number };
  w.frames = 0;
  let queue = new Map<number, FrameRequestCallback>();
  let nextId = 1;
  setInterval(() => {
    if (!queue.size) return;
    const run = queue;
    queue = new Map();
    w.frames++;
    const now = performance.now();
    run.forEach((cb) => cb(now));
  }, 1000 / fps);
  window.requestAnimationFrame = (cb) => (queue.set(nextId, cb), nextId++);
  window.cancelAnimationFrame = (id) => void queue.delete(id);
}

async function open(browser: Browser, baseURL: string, opts: { fps?: number; clearMs?: number; height?: number; hasTouch?: boolean } = {}) {
  const context = await browser.newContext({ viewport: { width: 800, height: opts.height ?? 1000 }, hasTouch: !!opts.hasTouch, baseURL });
  if (opts.fps) await context.addInitScript(frameRate, opts.fps);
  const page = await context.newPage();
  if (opts.clearMs)
    // Cosmetic only (theme.json is outside the gameplay hash): a long clear makes the resolving window observable.
    await page.route('**/theme.json', async (route) => {
      const json = await (await route.fetch()).json();
      await route.fulfill({ json: { ...json, feedback_ms: { ...json.feedback_ms, clear: opts.clearMs } } });
    });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return { context, page, errors, box: await ready(page, `./?seed=${recorded.seed}`) };
}

test('30, 60 and 144 fps traces give identical logical state hashes, matching Node', async ({ browser, baseURL }) => {
  test.setTimeout(180_000);
  const traces: Record<number, string[]> = {};
  const log: string[] = [];
  for (const fps of [30, 60, 144]) {
    const { context, page, errors, box } = await open(browser, baseURL!, { fps });
    // The page never gets more than the emulated rate; a loaded machine may give 144 less (the logged rate is the evidence).
    const measured = await page.evaluate(async () => {
      const w = window as unknown as { frames: number };
      const start = w.frames;
      await new Promise((r) => setTimeout(r, 1000));
      return w.frames - start;
    });
    expect(measured).toBeGreaterThan(fps * 0.25);
    expect(measured).toBeLessThan(fps * 1.2);
    traces[fps] = [];
    for (let i = 0; i < MOVES; i++) {
      await place(page, box, i);
      await expect(page.locator('#game')).toHaveAttribute('data-state', 'idle');
      await expect(page.locator('#save-status')).toHaveText('Saved');
      traces[fps].push(stateHash(await storedRun(page)));
    }
    await expect(page.locator('#score')).toHaveText(String(scores[MOVES - 1]));
    expect(errors).toEqual([]);
    log.push(`${fps} fps (measured ${measured} rAF/s): final ${traces[fps].at(-1)}`);
    await context.close();
  }
  for (const fps of [30, 60, 144]) expect(traces[fps], `${fps} fps trace`).toEqual(expected);
  console.log(`[${test.info().project.name}] ${MOVES} moves, Node final ${expected.at(-1)} | ${log.join(' | ')}`);
});

test('refresh during a clear: Continue shows the committed clear once, and play goes on', async ({ browser, baseURL }) => {
  test.setTimeout(90_000);
  const { context, page, errors, box } = await open(browser, baseURL!, { clearMs: 2000 });
  for (let i = 0; i < CLEAR_MOVE; i++) {
    await place(page, box, i);
    await expect(page.locator('#game')).toHaveAttribute('data-state', 'idle');
  }
  await place(page, box, CLEAR_MOVE);
  await expect(page.locator('#save-status')).toHaveText('Saved');
  expect(await gameState(page)).toBe('resolving'); // the reload lands inside the clear animation

  const reloaded = await ready(page, './');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('#game')).toHaveAttribute('data-state', 'idle'); // no replayed animation
  await expect(page.locator('#score')).toHaveText(String(scores[CLEAR_MOVE]));
  expect(stateHash(await storedRun(page))).toBe(expected[CLEAR_MOVE]);
  const row = await sample(page, Array.from({ length: 10 }, (_, x) => cellClient([x, 4], reloaded)));
  row.forEach((px, x) => expect(colorDistance(px, theme.empty_cell), `row 4 cell ${x}`).toBeLessThanOrEqual(6));

  await place(page, reloaded, CLEAR_MOVE + 1);
  await expect(page.locator('#score')).toHaveText(String(scores[CLEAR_MOVE + 1]));
  expect(errors).toEqual([]);
  await context.close();
});

test('a touch swipe on the board never scrolls the page; the same swipe outside it does', async ({ browser, baseURL }) => {
  // Shorter than the layout's minimum, so the page itself scrolls (GDD 7.2).
  const { context, page } = await open(browser, baseURL!, { height: 320, hasTouch: true });
  const cdp = await context.newCDPSession(page);
  const swipe = async ([x, y]: Point) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let i = 1; i <= 10; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - i * 15 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await canvasBox(page);
  };
  expect(await page.evaluate(() => document.documentElement.scrollHeight > innerHeight)).toBe(true);
  expect(await page.locator('#game canvas').evaluate((c) => getComputedStyle(c).touchAction)).toBe('none');

  // Focusing the board at the start may already have scrolled it into view; only the swipe's effect is checked.
  const before = await page.evaluate(() => scrollY);
  const onBoard = cellClient([5, 1], await canvasBox(page)); // an empty board cell, so nothing is grabbed either
  expect(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.tagName, onBoard)).toBe('CANVAS');
  await swipe(onBoard);
  expect(await page.evaluate(() => scrollY)).toBe(before);

  // Control: the same emulated swipe on HTML does scroll, so the unchanged offset above is the canvas refusing it.
  await page.evaluate(() => scrollTo(0, 0));
  const html = (await page.locator('#score-line').boundingBox())!;
  await swipe([html.x + 4, html.y + html.height / 2]);
  expect(await page.evaluate(() => scrollY)).toBeGreaterThan(0);
  await context.close();
});
