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

async function newContext(browser: import('@playwright/test').Browser, baseURL: string): Promise<BrowserContext> {
  const context = await browser.newContext({ viewport: { width: 800, height: 1000 }, baseURL });
  await context.addInitScript(countResults);
  return context;
}

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
