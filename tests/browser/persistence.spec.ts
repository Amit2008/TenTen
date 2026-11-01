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

const writeDb = (page: Page, key: string, value: unknown) =>
  page.evaluate(
    ({ key, value }) =>
      new Promise<void>((resolve) => {
        const r = indexedDB.open('line-garden');
        r.onsuccess = () => {
          const db = r.result;
          const tx = db.transaction('saves', 'readwrite');
          tx.objectStore('saves').put(value, key);
          tx.oncomplete = () => (db.close(), resolve());
        };
      }),
    { key, value },
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

test('Saving… shows while the transaction is open; Saved only after it completes', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ viewport: { width: 800, height: 1000 }, baseURL: baseURL! });
  // Keeps every readwrite transaction alive (chained reads) until the test releases it.
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
  const { page, box } = await openPage(context);
  await expect(saveStatus(page)).toHaveText('Saved');
  await page.evaluate(() => ((window as unknown as { holdWrites: boolean }).holdWrites = true));
  await place(page, box, 0);
  await page.waitForTimeout(500);
  await expect(saveStatus(page)).toHaveText('Saving…');
  await page.evaluate(() => ((window as unknown as { holdWrites: boolean }).holdWrites = false));
  await expect(saveStatus(page)).toHaveText('Saved');
  expect((await readDb(page)).current!.active!.score).toBe(scores[0]);
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

test('without IndexedDB the game still plays, marked session only', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ viewport: { width: 800, height: 1000 }, baseURL: baseURL! });
  await context.addInitScript(() => Object.defineProperty(window, 'indexedDB', { configurable: true, value: undefined }));
  const { page, box, errors } = await openPage(context);
  await expect(saveStatus(page)).toHaveText('Not saved (this session only)');
  await place(page, box, 0);
  await expect(page.locator('#score')).toHaveText(String(scores[0]));
  await page.getByRole('button', { name: 'Retry saving' }).click();
  await expect(saveStatus(page)).toHaveText('Not saved (this session only)');
  expect(errors).toEqual([]);
  await context.close();
});

test.describe('two tabs', () => {
  test('a stale tab never overwrites: it stops, and Load latest picks up the other tab’s run', async ({ browser, baseURL }, info) => {
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

  test('simultaneous moves: exactly one write lands, the other tab stops', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ viewport: { width: 800, height: 1000 }, baseURL: baseURL! });
    const a = await openPage(context);
    await expect(saveStatus(a.page)).toHaveText('Saved');
    const b = await openPage(context, './', true);
    await expect(saveStatus(b.page)).toHaveText('Saved');
    const before = (await readDb(a.page)).current!.storageRevision;
    // Both tabs commit a move (different ones) at the same moment.
    const go = async (p: typeof a, i: number) => {
      const { slot, anchor } = recorded.commands[i]!;
      await p.page.getByRole('button', { name: new RegExp(`^Slot ${slot + 1}`) }).click();
      await p.page.mouse.click(...cellClient(anchor, p.box));
    };
    await Promise.all([go(a, 0), go(b, 0)]);
    await expect.poll(async () => [await saveStatus(a.page).textContent(), await saveStatus(b.page).textContent()].sort()).toEqual([
      'Not saved (changed in another tab)',
      'Saved',
    ]);
    const stored = await readDb(a.page);
    expect(stored.current!.storageRevision).toBe(before + 1);
    await context.close();
  });

  test('a restart in another tab stops this tab’s writer', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ viewport: { width: 800, height: 1000 }, baseURL: baseURL! });
    const a = await openPage(context);
    await expect(saveStatus(a.page)).toHaveText('Saved');
    const b = await openPage(context, './?seed=99'); // a deliberate new game
    await expect(saveStatus(b.page)).toHaveText('Saved');
    const newRun = (await readDb(b.page)).current!.active!.sessionId;
    await a.page.bringToFront();
    await place(a.page, a.box, 0).catch(() => {});
    await expect(saveStatus(a.page)).toHaveText('Not saved (changed in another tab)');
    expect((await readDb(a.page)).current!.active!.sessionId).toBe(newRun);
    await context.close();
  });
});

test.describe('damaged and incompatible saves', () => {
  test('an unreadable record is preserved; Restore backup brings back the previous state', async ({ browser, baseURL }, info) => {
    const context = await browser.newContext({ viewport: { width: 800, height: 1000 }, baseURL: baseURL! });
    const { page, box } = await openPage(context);
    await place(page, box, 0);
    await place(page, box, 1);
    await expect(saveStatus(page)).toHaveText('Saved');
    const good = await readDb(page);
    await writeDb(page, 'current', { schemaVersion: 1, storageRevision: good.current!.storageRevision, garbage: true });

    await page.goto('./');
    const alert = page.getByRole('alert');
    await expect(alert).toContainText('could not be read');
    await page.screenshot({ path: `docs/evidence/t17/damaged-${info.project.name}.png` });
    await alert.getByRole('button', { name: 'Restore backup' }).click();
    await expect(page.getByRole('status')).toHaveText(/Renderer ready/);
    await continueRun(page);
    await expect(page.locator('#score')).toHaveText(String(scores[0])); // the backup is one move older
    const after = await readDb(page);
    expect(after.preserved).toMatchObject({ garbage: true });
    expect(after.backup).toEqual(good.backup); // backup stays the last known-good record
    await context.close();
  });

  test('a run saved under different rules is kept and a new game starts only when chosen', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ viewport: { width: 800, height: 1000 }, baseURL: baseURL! });
    const { page, box } = await openPage(context);
    await place(page, box, 0);
    await expect(saveStatus(page)).toHaveText('Saved');
    const good = await readDb(page);
    const old = { ...good.current!, active: { ...good.current!.active!, gameplayHash: 'sha256:old-rules' } };
    await writeDb(page, 'current', old);

    await page.goto('./');
    const alert = page.getByRole('alert');
    await expect(alert).toContainText('different rules');
    await expect(alert.getByRole('button')).toHaveText(['Restore backup', 'Start a new game']);
    await alert.getByRole('button', { name: 'Start a new game' }).click();
    await expect(page.locator('#score')).toHaveText('0');
    await expect(saveStatus(page)).toHaveText('Saved');
    expect((await readDb(page)).preserved).toEqual(old);
    await context.close();
  });
});

test.describe('schema upgrades', () => {
  /** Makes this page open the save database one version higher, as a newer build would. */
  const newerBuild = () => {
    const open = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function (this: IDBFactory, name: string, version?: number) {
      return open.call(this, name, name === 'line-garden' && version ? version + 1 : version);
    } as IDBFactory['open'];
  };

  test('an upgrade blocked by another tab says so and continues once that tab lets go', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ viewport: { width: 800, height: 1000 }, baseURL: baseURL! });
    const old = await openPage(context);
    await expect(saveStatus(old.page)).toHaveText('Saved');
    // An old tab that does not handle versionchange: hold a raw v1 connection open.
    await old.page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          const r = indexedDB.open('line-garden', 1);
          r.onsuccess = () => ((window as unknown as { held: IDBDatabase }).held = r.result, resolve());
        }),
    );
    const page = await context.newPage();
    await page.addInitScript(newerBuild);
    await page.goto('./');
    await expect(page.getByRole('alert')).toContainText('waiting for another Line Garden tab');
    await expect(page.getByRole('button', { name: 'Reload' })).toBeVisible();
    await old.page.evaluate(() => (window as unknown as { held: IDBDatabase }).held.close());
    await expect(page.getByRole('status')).toHaveText(/Renderer ready/);
    await expect(page.getByRole('alert')).toBeHidden();
    await expect(page.locator('#score')).toHaveText('0');
    // The running old app closed its own connection and stopped saving.
    await expect(old.page.getByRole('alert')).toContainText('newer version of Line Garden');
    await expect(saveStatus(old.page)).toHaveText('Not saved (this session only)');
    await context.close();
  });
});
