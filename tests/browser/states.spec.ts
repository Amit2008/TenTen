import { expect, test, type Browser, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createGenerator } from '../../src/application/piece-source/piece-source';
import { GameSession, startSession } from '../../src/application/session/session';
import type { Cell } from '../../src/domain/models/types';
import { cellOrigin, logicalToClient, type ClientBox, type Point } from '../../src/presentation/views/layout';
import { BOARD, canvasBox, colorDistance, ready, rules, sample, theme, VIEWPORT } from './helpers';

// Seed 2026's recorded game (T11): move 17 clears row 4.
const recorded = JSON.parse(readFileSync('tests/property/fixtures/recorded-seed-2026.json', 'utf8')) as {
  seed: number;
  commands: { slot: number; anchor: Cell }[];
};
const CLEAR_MOVE = 16; // zero-based index of the clearing move
const scores: number[] = [];
{
  const m = new GameSession(rules, startSession(rules, 'm', createGenerator(recorded.seed)));
  for (const { slot, anchor } of recorded.commands) {
    const s = m.state;
    const r = m.place({ type: 'PlacePiece', sessionId: s.sessionId, expectedRevision: s.revision, instanceId: s.tray[slot]!.instanceId, anchor });
    if (!r.accepted) throw new Error('recorded command rejected');
    scores.push(r.state.score);
  }
  if (scores[CLEAR_MOVE]! - scores[CLEAR_MOVE - 1]! < 10) throw new Error('move 17 no longer clears a line');
}

const cellClient = ([x, y]: Cell, box: ClientBox, dx = 0.5, dy = 0.5): Point => {
  const [left, top] = cellOrigin(BOARD, [x, y]);
  return logicalToClient([left + dx * BOARD.pitch, top + dy * BOARD.pitch], box, VIEWPORT);
};

/** Counts rAF calls and live listeners on every target, including ones removed through an AbortSignal. */
function instrument() {
  const w = window as unknown as { rafCalls: number; liveListeners: () => number };
  w.rafCalls = 0;
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => (w.rafCalls++, raf(cb));
  const live = new Set<{ t: EventTarget; type: string; fn: unknown; capture: boolean }>();
  const find = (t: EventTarget, type: string, fn: unknown, capture: boolean) =>
    [...live].find((e) => e.t === t && e.type === type && e.fn === fn && e.capture === capture);
  const add = EventTarget.prototype.addEventListener;
  const remove = EventTarget.prototype.removeEventListener;
  const captureOf = (o: unknown) => (typeof o === 'boolean' ? o : !!(o as AddEventListenerOptions | undefined)?.capture);
  EventTarget.prototype.addEventListener = function (type, fn, options) {
    const capture = captureOf(options);
    if (fn && !find(this, type, fn, capture)) {
      const entry = { t: this, type, fn, capture };
      live.add(entry);
      const signal = (options as AddEventListenerOptions | undefined)?.signal;
      signal?.addEventListener('abort', () => live.delete(entry));
    }
    return add.call(this, type, fn, options);
  };
  EventTarget.prototype.removeEventListener = function (type, fn, options) {
    const entry = find(this, type, fn, captureOf(options));
    if (entry) live.delete(entry);
    return remove.call(this, type, fn, options);
  };
  w.liveListeners = () => [...live].filter((e) => e.type !== 'abort').length;
}

async function open(browser: Browser, baseURL: string, feedbackMs: { place: number; clear: number }, reducedMotion: 'reduce' | 'no-preference' = 'no-preference') {
  const context = await browser.newContext({ viewport: { width: 800, height: 1000 }, baseURL, reducedMotion });
  await context.addInitScript(instrument);
  const page = await context.newPage();
  // Slow, cosmetic-only timings (theme.json is outside the gameplay hash) make the resolving window observable.
  await page.route('**/theme.json', async (route) => {
    const json = await (await route.fetch()).json();
    await route.fulfill({ json: { ...json, feedback_ms: { ...json.feedback_ms, ...feedbackMs, invalid_return: 120 } } });
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return { context, page, errors, box: await ready(page, `./?seed=${recorded.seed}`) };
}

const state = (page: Page) => page.locator('#game').getAttribute('data-state');
const rafCalls = (page: Page) => page.evaluate(() => (window as unknown as { rafCalls: number }).rafCalls);
async function place(page: Page, box: ClientBox, i: number) {
  const { slot, anchor } = recorded.commands[i]!;
  await page.getByRole('button', { name: new RegExp(`^Slot ${slot + 1}`) }).click();
  await page.mouse.click(...cellClient(anchor, box));
}
const hide = (page: Page) =>
  page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });

test('the move commits before its clear animation, locks input, pauses when hidden and never replays on Resume', async ({ browser, baseURL }, info) => {
  test.setTimeout(90_000);
  const { context, page, errors, box } = await open(browser, baseURL!, { place: 0, clear: 2000 });
  for (let i = 0; i < CLEAR_MOVE; i++) await place(page, box, i);
  await expect(page.locator('#score')).toHaveText(String(scores[CLEAR_MOVE - 1]));
  await expect.poll(() => state(page)).toBe('idle');

  await place(page, box, CLEAR_MOVE);
  // Committed at once: score and tray already show the result while the clear is still fading.
  await expect(page.locator('#score')).toHaveText(String(scores[CLEAR_MOVE]));
  expect(await state(page)).toBe('resolving');
  await page.screenshot({ path: `docs/evidence/t16/clear-fade-${info.project.name}.png` });

  // A command during resolving is not accepted.
  await place(page, box, CLEAR_MOVE + 1);
  await expect(page.locator('#score')).toHaveText(String(scores[CLEAR_MOVE]));

  // Hidden tab: paused, Resume shown, and the render loop stops requesting frames.
  await hide(page);
  expect(await state(page)).toBe('paused');
  await expect(page.getByRole('button', { name: 'Resume' })).toBeFocused();
  const before = await rafCalls(page);
  await page.waitForTimeout(4000); // twice the whole clear animation (2000 ms, the theme maximum)
  expect(await rafCalls(page)).toBeLessThanOrEqual(before + 1);
  expect(await state(page)).toBe('paused');
  await page.screenshot({ path: `docs/evidence/t16/paused-${info.project.name}.png` });

  // Resume finishes the same clear once; nothing is applied again.
  await page.evaluate(() => Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }));
  await page.getByRole('button', { name: 'Resume' }).click();
  expect(await state(page)).toBe('resolving');
  expect(await rafCalls(page)).toBeGreaterThan(before);
  await expect.poll(() => state(page), { timeout: 10_000 }).toBe('selected'); // the slot picked during resolving
  await expect(page.locator('#score')).toHaveText(String(scores[CLEAR_MOVE]));
  // Row 4 is empty once the fade is gone.
  await canvasBox(page);
  const row = await sample(page, Array.from({ length: 10 }, (_, x) => cellClient([x, 4], box)));
  row.forEach((px, x) => expect(colorDistance(px, theme.empty_cell), `row 4 cell ${x}`).toBeLessThanOrEqual(6));

  // Input works again: the slot picked during resolving is still selected, so one board click places it once.
  await page.mouse.click(...cellClient(recorded.commands[CLEAR_MOVE + 1]!.anchor, box));
  await expect(page.locator('#score')).toHaveText(String(scores[CLEAR_MOVE + 1]));
  expect(errors).toEqual([]);
  await context.close();
});

test('blur pauses; Escape with nothing selected pauses; Resume returns focus to the board', async ({ browser, baseURL }) => {
  const { context, page } = await open(browser, baseURL!, { place: 90, clear: 180 });
  await page.evaluate(() => dispatchEvent(new Event('blur')));
  expect(await state(page)).toBe('paused');
  await expect(page.getByRole('dialog', { name: 'Paused' })).toBeVisible();
  expect(await page.locator('#game canvas').evaluate((c) => (c as HTMLElement).inert)).toBe(true);
  await page.keyboard.press('Enter'); // activates the focused Resume button
  expect(await state(page)).toBe('idle');
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('CANVAS');
  await page.keyboard.press('1');
  await page.keyboard.press('Escape'); // cancels the selection only
  expect(await state(page)).toBe('idle');
  await page.keyboard.press('Escape'); // nothing selected: pause
  expect(await state(page)).toBe('paused');
  await context.close();
});

test('reduced motion: the placement keeps cells unscaled while it resolves', async ({ browser, baseURL }) => {
  for (const motion of ['no-preference', 'reduce'] as const) {
    const { context, page, box } = await open(browser, baseURL!, { place: 2000, clear: 180 }, motion);
    const { anchor } = recorded.commands[0]!;
    await place(page, box, 0);
    expect(await state(page)).toBe('resolving');
    await canvasBox(page);
    // Just inside the 3 px gap left of a placed tile: any scale above about 1.02 covers it; unscaled it is background.
    const first = new GameSession(rules, startSession(rules, 'm', createGenerator(recorded.seed)));
    const shape = rules.config.catalog.find((s) => s.id === first.state.tray[recorded.commands[0]!.slot]!.shapeId)!;
    const [cx, cy] = shape.cells[0]!;
    const [gap] = await sample(page, [cellClient([anchor[0] + cx, anchor[1] + cy], box, 0.04, 0.5)]);
    const isBackground = colorDistance(gap!, theme.background) <= 6;
    expect(isBackground, `${motion}: gap pixel rgb(${gap})`).toBe(motion === 'reduce');
    await context.close();
  }
});

test('Retry tears the session down: no listener growth and no late callbacks', async ({ browser, baseURL }) => {
  const { context, page, errors, box } = await open(browser, baseURL!, { place: 0, clear: 2000 });
  const listeners = () => page.evaluate(() => (window as unknown as { liveListeners: () => number }).liveListeners());
  const baseline = await listeners();
  const counts: number[] = [];
  for (let round = 0; round < 5; round++) {
    await place(page, box, 0); // leaves feedback or a selection in flight
    await page.evaluate(() => (document.getElementById('retry') as HTMLButtonElement).click());
    await expect(page.getByRole('status')).toHaveText(/Renderer ready/);
    await canvasBox(page);
    counts.push(await listeners());
  }
  console.log(`[${test.info().project.name}] live listeners: baseline ${baseline}, after each restart ${counts.join(', ')}`);
  expect(counts).toEqual(Array(5).fill(baseline));
  expect(await state(page)).toBe('idle');
  await expect(page.locator('#score')).toHaveText('0');
  await expect(page.locator('#game canvas')).toHaveCount(1);
  expect(errors).toEqual([]);
  await context.close();
});
