import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createGenerator } from '../../src/application/piece-source/piece-source';
import { GameSession, startSession } from '../../src/application/session/session';
import type { Cell } from '../../src/domain/models/types';
import { cellOrigin, logicalToClient, type ClientBox } from '../../src/presentation/views/layout';
import { BOARD, canvasBox, ready, rules, VIEWPORT } from './helpers';

// Real IndexedDB in Chromium. Each test gets a fresh browser context, so storage starts empty.
const recorded = JSON.parse(readFileSync('tests/property/fixtures/recorded-seed-2026.json', 'utf8')) as {
  seed: number;
  commands: { slot: number; anchor: Cell }[];
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

type Stored = { current?: { storageRevision: number; active: { sessionId: string; score: number; revision: number } | null }; backup?: { storageRevision: number }; preserved?: unknown };

/** Reads the save records through a separate connection, as another tab would. */
const readDb = (page: Page): Promise<Stored> =>
  page.evaluate(
    () =>
      new Promise<Stored>((resolve, reject) => {
        const r = indexedDB.open('line-garden');
        r.onerror = () => reject(r.error);
        r.onsuccess = () => {
          const db = r.result;
          const tx = db.transaction('saves');
          const out: Record<string, unknown> = {};
          for (const k of ['current', 'backup', 'preserved']) tx.objectStore('saves').get(k).onsuccess = (e) => (out[k] = (e.target as IDBRequest).result);
          tx.oncomplete = () => (db.close(), resolve(out as Stored));
        };
      }),
  );

const saveStatus = (page: Page) => page.locator('#save-status');
const cellClient = ([x, y]: Cell, box: ClientBox) => {
  const [left, top] = cellOrigin(BOARD, [x, y]);
  return logicalToClient([left + BOARD.pitch / 2, top + BOARD.pitch / 2], box, VIEWPORT);
};

/** Recorded move i through a slot button and a board click; waits until feedback has resolved. */
async function place(page: Page, box: ClientBox, i: number) {
  const { slot, anchor } = recorded.commands[i]!;
  await page.getByRole('button', { name: new RegExp(`^Slot ${slot + 1}`) }).click();
  await page.mouse.click(...cellClient(anchor, box));
  await expect(page.locator('#game')).toHaveAttribute('data-state', 'idle');
}

/** Opens the game. Without a seed the main menu comes first; `resume` then clicks Continue (T18). */
async function openPage(context: BrowserContext, path = `./?seed=${SEED}`, resume = false) {
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const box = await ready(page, path);
  if (resume) await continueRun(page);
  return { page, errors, box };
}

async function continueRun(page: Page) {
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('#game')).toHaveAttribute('data-state', 'idle');
}

test('restore after reload keeps board, tray, score and the future deals', async ({ browser, baseURL }, info) => {
  const context = await browser.newContext({ viewport: { width: 800, height: 1000 }, baseURL: baseURL! });
  const { page, box, errors } = await openPage(context);
  await expect(saveStatus(page)).toHaveText('Saved');
  for (let i = 0; i < 5; i++) await place(page, box, i);
  await expect(saveStatus(page)).toHaveText('Saved');
  const before = await readDb(page);
  expect(before.current!.storageRevision).toBe(6); // the new run, then one write per move
  expect(before.current!.active!.score).toBe(scores[4]);
  expect(before.backup!.storageRevision).toBe(5);
  const shot = await page.locator('#game canvas').screenshot();

  await ready(page, './'); // no seed: the menu offers Continue
  await continueRun(page);
  await expect(saveStatus(page)).toHaveText('Saved');
  await expect(page.locator('#score')).toHaveText(String(scores[4]));
  await canvasBox(page);
  expect((await page.locator('#game canvas').screenshot()).equals(shot), 'board and tray pixels identical after reload').toBe(true);
  // The next recorded moves score exactly as in Node: the generator state came back too.
  for (let i = 5; i < 8; i++) await place(page, box, i);
  await expect(page.locator('#score')).toHaveText(String(scores[7]));
  expect((await readDb(page)).current!.active!.sessionId).toBe(before.current!.active!.sessionId);
  await page.screenshot({ path: `docs/evidence/t17/restored-${info.project.name}.png` });
  expect(errors).toEqual([]);
  await context.close();
});

test('a failed write (quota) keeps the run playable as session only, and Retry saves the latest state', async ({ browser, baseURL }, info) => {
  const context = await browser.newContext({ viewport: { width: 800, height: 1000 }, baseURL: baseURL! });
  await context.addInitScript(() => {
    const w = window as unknown as { failPuts: boolean };
    w.failPuts = false;
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      if (w.failPuts) throw new DOMException('Simulated full disk', 'QuotaExceededError');
      return put.apply(this, args);
    } as IDBObjectStore['put'];
  });
  const { page, box, errors } = await openPage(context);
  await expect(saveStatus(page)).toHaveText('Saved');
  await place(page, box, 0);
  await expect(saveStatus(page)).toHaveText('Saved');
  const saved = await readDb(page);

  await page.evaluate(() => ((window as unknown as { failPuts: boolean }).failPuts = true));
  await place(page, box, 1);
  await expect(saveStatus(page)).toHaveText('Not saved (this session only)');
  await expect(page.getByRole('button', { name: 'Retry saving' })).toBeVisible();
  await place(page, box, 2); // still playable
  await expect(page.locator('#score')).toHaveText(String(scores[2]));
  // The aborted transaction wrote nothing: the stored record is untouched.
  expect(await readDb(page)).toEqual(saved);
  await page.screenshot({ path: `docs/evidence/t17/session-only-${info.project.name}.png` });

  await page.evaluate(() => ((window as unknown as { failPuts: boolean }).failPuts = false));
  await page.getByRole('button', { name: 'Retry saving' }).click();
  await expect(saveStatus(page)).toHaveText('Saved');
  const after = await readDb(page);
  expect(after.current!.active!.score).toBe(scores[2]);
  expect(after.current!.storageRevision).toBe(saved.current!.storageRevision + 1); // only the latest snapshot
  expect(errors).toEqual([]);
  await context.close();
});

test.describe('two tabs', () => {
  test('a stale tab never overwrites: it stops, and Load latest picks up the other tab’s run', async ({ browser, baseURL }, info) => {
    test.setTimeout(60_000); // two pages, several saves and a reload: slow on a loaded machine
    const context = await browser.newContext({ viewport: { width: 800, height: 1000 }, baseURL: baseURL! });
    const a = await openPage(context);
    await expect(saveStatus(a.page)).toHaveText('Saved');
    const b = await openPage(context, './', true); // continues the same run
    await expect(saveStatus(b.page)).toHaveText('Saved');

    await place(a.page, a.box, 0);
    await expect(saveStatus(a.page)).toHaveText('Saved');
    const afterA = await readDb(a.page);

    // B still shows the old board and tries the same first move: its write must be refused.
    await b.page.bringToFront();
    await place(b.page, b.box, 0).catch(() => {}); // the game locks, so data-state becomes paused
    await expect(saveStatus(b.page)).toHaveText('Not saved (changed in another tab)');
    await expect(b.page.getByRole('alert')).toContainText('changed in another tab');
    await expect(b.page.locator('#game')).toHaveAttribute('data-state', 'paused');
    expect(await b.page.locator('#game canvas').evaluate((c) => (c as HTMLElement).inert)).toBe(true);
    expect(await readDb(b.page)).toEqual(afterA); // nothing overwritten
    await b.page.screenshot({ path: `docs/evidence/t17/conflict-${info.project.name}.png` });

    await b.page.getByRole('button', { name: 'Load latest' }).click();
    await expect(saveStatus(b.page)).toHaveText('Saved');
    await expect(b.page.locator('#score')).toHaveText(String(scores[0]));
    await place(b.page, b.box, 1);
    await expect(saveStatus(b.page)).toHaveText('Saved');

    // Now A is the stale one.
    await a.page.bringToFront();
    await place(a.page, a.box, 1).catch(() => {});
    await expect(saveStatus(a.page)).toHaveText('Not saved (changed in another tab)');
    expect((await readDb(a.page)).current!.active!.score).toBe(scores[1]);
    expect([...a.errors, ...b.errors]).toEqual([]);
    await context.close();
  });
});
