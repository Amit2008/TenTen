import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createGenerator } from '../../src/application/piece-source/piece-source';
import { GameSession, startSession } from '../../src/application/session/session';
import type { Cell } from '../../src/domain/models/types';
import { cellOrigin, logicalToClient, type ClientBox } from '../../src/presentation/views/layout';
import { BOARD, ready, rules, VIEWPORT } from './helpers';

// Seed 2026's recorded game (T11) ends in game over after 20 moves with score 86.
const recorded = JSON.parse(readFileSync('tests/property/fixtures/recorded-seed-2026.json', 'utf8')) as {
  seed: number;
  commands: { slot: number; anchor: Cell }[];
  expected: { moves: number; score: number; status: string };
};
const SEED = recorded.seed;
const scores: number[] = [];
{
  const m = new GameSession(rules, startSession(rules, 'm', createGenerator(SEED)));
  for (const { slot, anchor } of recorded.commands) {
    const s = m.state;
    m.place({ type: 'PlacePiece', sessionId: s.sessionId, expectedRevision: s.revision, instanceId: s.tray[slot]!.instanceId, anchor });
    scores.push(m.state.score);
  }
}

const state = (page: Page) => page.locator('#game');
const score = (page: Page) => page.locator('#score');
const saveStatus = (page: Page) => page.locator('#save-status');
const cellClient = ([x, y]: Cell, box: ClientBox) => {
  const [left, top] = cellOrigin(BOARD, [x, y]);
  return logicalToClient([left + BOARD.pitch / 2, top + BOARD.pitch / 2], box, VIEWPORT);
};
async function place(page: Page, box: ClientBox, i: number) {
  const { slot, anchor } = recorded.commands[i]!;
  await page.getByRole('button', { name: new RegExp(`^Slot ${slot + 1}`) }).click();
  await page.mouse.click(...cellClient(anchor, box));
  await expect(state(page)).not.toHaveAttribute('data-state', /resolving|selected/);
}
type Stored = { current?: { storageRevision: number; best: Record<string, number>; active: { sessionId: string; score: number; status: string } | null } };
const readDb = (page: Page): Promise<Stored> =>
  page.evaluate(
    () =>
      new Promise<Stored>((resolve) => {
        const r = indexedDB.open('line-garden');
        r.onsuccess = () => {
          const db = r.result;
          const get = db.transaction('saves').objectStore('saves').get('current');
          get.onsuccess = () => (db.close(), resolve({ current: get.result }));
        };
      }),
  );
/** Counts every time the results dialog becomes visible. */
function countResults() {
  const w = window as unknown as { resultsShown: number };
  w.resultsShown = 0;
  addEventListener('DOMContentLoaded', () => {
    const results = document.getElementById('results')!;
    new MutationObserver(() => !results.hidden && w.resultsShown++).observe(results, { attributes: true, attributeFilter: ['hidden'] });
  });
}
const resultsShown = (page: Page) => page.evaluate(() => (window as unknown as { resultsShown: number }).resultsShown);

async function newContext(browser: import('@playwright/test').Browser, baseURL: string): Promise<BrowserContext> {
  const context = await browser.newContext({ viewport: { width: 800, height: 1000 }, baseURL });
  await context.addInitScript(countResults);
  return context;
}

test('menu walkthrough: New game, pause, Main menu keeps the run, Continue, Restart asks first', async ({ browser, baseURL }, info) => {
  const context = await newContext(browser, baseURL!);
  const page = await context.newPage();
  const box = await ready(page, './');
  const menu = page.getByRole('dialog', { name: 'Line Garden' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('button', { name: 'Continue' })).toBeHidden(); // nothing saved yet
  await expect(menu.getByRole('button', { name: 'New game' })).toBeFocused();
  await page.screenshot({ path: `docs/evidence/t18/menu-${info.project.name}.png` });
  await menu.getByRole('button', { name: 'New game' }).click(); // no active run: no confirmation
  await expect(state(page)).toHaveAttribute('data-state', 'idle');
  await expect(saveStatus(page)).toHaveText('Saved');
  const first = (await readDb(page)).current!.active!.sessionId;

  // A run in progress: pause, then Main menu keeps it.
  await page.goto(`./?seed=${SEED}`);
  for (let i = 0; i < 3; i++) await place(page, box, i);
  await expect(saveStatus(page)).toHaveText('Saved');
  await page.keyboard.press('Escape');
  await expect(state(page)).toHaveAttribute('data-state', 'paused');
  await page.getByRole('button', { name: 'Main menu' }).click();
  await expect(menu.getByRole('button', { name: 'Continue' })).toBeVisible();
  await menu.getByRole('button', { name: 'Continue' }).click();
  await expect(score(page)).toHaveText(String(scores[2]));
  await expect(state(page)).toHaveAttribute('data-state', 'idle');

  // Restart asks; Cancel keeps playing the same run.
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Restart' }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Start a new game?' });
  await expect(confirm).toBeVisible();
  await page.screenshot({ path: `docs/evidence/t18/confirm-${info.project.name}.png` });
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(state(page)).toHaveAttribute('data-state', 'idle');
  await place(page, box, 3);
  await expect(score(page)).toHaveText(String(scores[3]));

  // Confirmed: a new run replaces it in storage.
  const before = (await readDb(page)).current!.active!.sessionId;
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Restart' }).click();
  await confirm.getByRole('button', { name: 'Start new game' }).click();
  await expect(score(page)).toHaveText('0');
  await expect(saveStatus(page)).toHaveText('Saved');
  const after = (await readDb(page)).current!.active!.sessionId;
  expect(after).not.toBe(before);
  expect(after).not.toBe(first);
  await context.close();
});

test('refresh trace: Continue restores the last completed save, never a write that did not finish', async ({ browser, baseURL }) => {
  const context = await newContext(browser, baseURL!);
  // Keeps readwrite transactions open while held; the reload then aborts them.
  await context.addInitScript(() => {
    const w = window as unknown as { holdWrites: boolean };
    w.holdWrites = false;
    const transaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (this: IDBDatabase, ...args: Parameters<IDBDatabase['transaction']>) {
      const tx = transaction.apply(this, args);
      if (args[1] === 'readwrite' && w.holdWrites) {
        const store = tx.objectStore('saves');
        const spin = () => {
          if (w.holdWrites) store.get('spin').onsuccess = spin;
        };
        spin();
      }
      return tx;
    } as IDBDatabase['transaction'];
  });
  const page = await context.newPage();
  const box = await ready(page, `./?seed=${SEED}`);
  await place(page, box, 0);
  await place(page, box, 1);
  await expect(saveStatus(page)).toHaveText('Saved');
  await page.evaluate(() => ((window as unknown as { holdWrites: boolean }).holdWrites = true));
  await place(page, box, 2);
  await expect(score(page)).toHaveText(String(scores[2]));
  await expect(saveStatus(page)).toHaveText('Saving…'); // never "Saved" for this move
  const trace = [`before reload: shown ${scores[2]}, status Saving…`];

  await ready(page, './'); // the unfinished transaction dies with the page
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(score(page)).toHaveText(String(scores[1]));
  await expect(saveStatus(page)).toHaveText('Saved');
  trace.push(`after reload: Continue shows ${scores[1]} (last completed save), stored ${(await readDb(page)).current!.active!.score}`);
  // The restored run continues exactly: the lost move can be played again and scores the same.
  await place(page, box, 2);
  await expect(score(page)).toHaveText(String(scores[2]));
  await expect(saveStatus(page)).toHaveText('Saved');
  trace.push(`replayed move 3: ${scores[2]}, Saved`);
  console.log(`[${test.info().project.name}] ${trace.join(' | ')}`);
  await context.close();
});

test('game over shows results once; a refresh neither shows them again nor counts the score twice', async ({ browser, baseURL }, info) => {
  test.setTimeout(120_000);
  const context = await newContext(browser, baseURL!);
  const page = await context.newPage();
  const box = await ready(page, `./?seed=${SEED}`);
  for (let i = 0; i < recorded.commands.length; i++) await place(page, box, i);
  const results = page.getByRole('dialog', { name: 'No moves left' });
  await expect(results).toBeVisible();
  await expect(page.locator('#results-score')).toHaveText(String(recorded.expected.score));
  await expect(page.locator('#results-best')).toHaveText(String(recorded.expected.score));
  await expect(results.getByRole('button', { name: 'Play again' })).toBeFocused();
  await page.screenshot({ path: `docs/evidence/t18/results-${info.project.name}.png` });
  await expect(saveStatus(page)).toHaveText('Saved');
  const stored = (await readDb(page)).current!;
  expect(stored.active!.status).toBe('game_over');
  const hash = Object.keys(stored.best)[0]!;
  expect(stored.best[hash]).toBe(recorded.expected.score);
  expect(await resultsShown(page)).toBe(1);

  await results.getByRole('button', { name: 'Main menu' }).click();
  const menu = page.getByRole('dialog', { name: 'Line Garden' });
  await expect(menu.getByRole('button', { name: 'Continue' })).toBeHidden(); // a finished run is not continuable

  await ready(page, './');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('button', { name: 'Continue' })).toBeHidden();
  expect(await resultsShown(page)).toBe(0); // not shown again after the refresh
  expect((await readDb(page)).current!.best[hash]).toBe(recorded.expected.score);

  // Play Again from a finished run needs no confirmation and keeps the best score.
  await menu.getByRole('button', { name: 'New game' }).click();
  await expect(score(page)).toHaveText('0');
  await expect(saveStatus(page)).toHaveText('Saved');
  expect((await readDb(page)).current!.best[hash]).toBe(recorded.expected.score);
  await context.close();
});

test('New game in another tab asks first, then stops this tab’s writer', async ({ browser, baseURL }) => {
  const context = await newContext(browser, baseURL!);
  const a = await context.newPage();
  const boxA = await ready(a, `./?seed=${SEED}`);
  await place(a, boxA, 0);
  await expect(saveStatus(a)).toHaveText('Saved');

  const b = await context.newPage();
  await ready(b, './');
  await b.getByRole('button', { name: 'New game' }).click();
  const confirm = b.getByRole('alertdialog', { name: 'Start a new game?' });
  await expect(confirm).toBeVisible(); // A's unfinished run is in storage
  await confirm.getByRole('button', { name: 'Start new game' }).click();
  await expect(saveStatus(b)).toHaveText('Saved');

  await a.bringToFront();
  await place(a, boxA, 1).catch(() => {});
  await expect(saveStatus(a)).toHaveText('Not saved (changed in another tab)');
  await a.getByRole('button', { name: 'Load latest' }).click();
  await expect(score(a)).toHaveText('0'); // B's new run
  await context.close();
});
