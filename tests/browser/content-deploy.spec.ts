import { readFileSync } from 'node:fs';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { ready, release } from './helpers';

// T24: content updates without an application rebuild. The same production build runs throughout; only the files the
// "host" serves change. The host is emulated by route interception: it serves content/index.json and any newly
// published version directory from memory, and passes everything else (the build, release 1.1.0) to the real server.

type Files = Record<string, string | Buffer>;

/** A new immutable version directory derived from 1.1.0, as an operator would author it. */
function version(v: string, edit: (c: Record<string, any>) => void): Files {
  const c: Record<string, any> = Object.fromEntries(['rules', 'pieces', 'theme', 'runtime', 'audio'].map((f) => [f, release(`${f}.json`)]));
  c.manifest = { ...release('manifest.json'), content_version: v };
  edit(c);
  const files: Files = Object.fromEntries(Object.entries(c).map(([name, json]) => [`releases/${v}/${name}.json`, JSON.stringify(json)]));
  for (const effect of Object.values(c.audio.effects as Record<string, string | null>))
    if (effect) files[`releases/${v}/${effect}`] = readFileSync(`public/content/releases/1.1.0/${effect}`);
  return files;
}

/** Gameplay change: 8×8 board, 2 slots, 20 points a line, one piece removed and one added, new colors, less audio. */
const GAMEPLAY = version('1.2.0', (c) => {
  c.rules.board = { columns: 8, rows: 8 };
  c.rules.tray_size = 2;
  c.rules.score.points_per_completed_line = 20;
  c.pieces.shapes = c.pieces.shapes.filter((s: { id: string }) => s.id !== 'bar_5_h');
  c.pieces.shapes.push({ id: 'skew_4', cells: [[0, 0], [1, 0], [1, 1], [2, 1]], weight: 2, color_key: 'skew_4' });
  c.theme.colors.skew_4 = '#3F6FB5';
  c.theme.empty_cell = '#E4E0D6';
  c.audio.effects.pick = null;
});
/** Cosmetic change only: tile colors. */
const COSMETIC = version('1.1.1', (c) => {
  for (const key of Object.keys(c.theme.colors)) c.theme.colors[key] = '#9A4F8C';
});

const index = (v: string) => JSON.stringify({ schema_version: 1, content_version: v, manifest: `releases/${v}/manifest.json` });

/** The emulated host for one browser context. */
async function host(context: BrowserContext) {
  const published: Files = {};
  let current = index('1.1.0');
  await context.route('**/content/**', (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^.*?\/content\//, '');
    if (path === 'index.json') return route.fulfill({ body: current, contentType: 'application/json' });
    const body = published[path];
    return body === undefined ? route.continue() : route.fulfill({ body, contentType: path.endsWith('.wav') ? 'audio/wav' : 'application/json' });
  });
  return {
    /** Uploads a version directory and checks every URL answers before anything points at it. */
    async publish(page: Page, files: Files) {
      Object.assign(published, files);
      for (const path of Object.keys(files)) expect((await page.request.get(`./content/${path}`)).ok(), path).toBe(true);
    },
    switchTo: (v: string) => void (current = index(v)),
  };
}

const stored = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<{ active: { gameplayHash: string; score: number; board: { columns: number } } | null; best: Record<string, number> }>((resolve) => {
        const r = indexedDB.open('line-garden');
        r.onsuccess = () => {
          const get = r.result.transaction('saves').objectStore('saves').get('current');
          get.onsuccess = () => (r.result.close(), resolve(get.result));
        };
      }),
  );

let placed = 0;
async function placeOne(page: Page) {
  const before = Number(await page.locator('#score').textContent());
  await page.locator('#slots button:enabled').first().click();
  // Each call places one column further right, clear of earlier pieces near the top-left default spot.
  for (let i = 0; i < placed * 3; i++) await page.keyboard.press('ArrowRight');
  placed++;
  await page.keyboard.press('Enter');
  await expect(page.locator('#score')).not.toHaveText(String(before));
  await expect(page.locator('#save-status')).toHaveText('Saved');
}

test('a gameplay update: old tab keeps its version, new loads get new rules and separate records, rollback restores', async ({ browser, baseURL }) => {
  placed = 0;
  const context = await browser.newContext({ baseURL: baseURL! });
  const server = await host(context);
  const old = await context.newPage();
  await ready(old, './?seed=1');
  await placeOne(old);
  const v1 = (await stored(old)).active!;

  await server.publish(old, GAMEPLAY);
  server.switchTo('1.2.0');

  // The open tab keeps 1.1.0 for its whole session: same rules, still 3 slots, moves still save.
  await placeOne(old);
  await expect(old.getByRole('status')).toHaveText(/Content 1\.1\.0/);
  await expect(old.locator('#slots button')).toHaveCount(3);
  expect((await stored(old)).active!.gameplayHash).toBe(v1.gameplayHash);
  await old.close();

  // A new load gets 1.2.0: the 1.1.0 run cannot be continued under the new rules, and a new game uses them.
  const fresh = await context.newPage();
  await fresh.goto('./');
  // The player is asked before anything replaces the old run (T17); the old run is kept in the browser.
  await expect(fresh.getByText('played with different rules')).toBeVisible();
  await fresh.getByRole('button', { name: 'Start a new game' }).click();
  await expect(fresh.getByRole('status')).toHaveText(/Content 1\.2\.0/);
  await expect(fresh.locator('#slots button')).toHaveCount(2);
  await placeOne(fresh);
  const v2 = await stored(fresh);
  expect(v2.active!.board.columns).toBe(8);
  expect(v2.active!.gameplayHash).not.toBe(v1.gameplayHash);
  // Best scores are kept per ruleset: the 1.1.0 record is untouched by 1.2.0 play.
  expect(v2.best[v1.gameplayHash]).toBeGreaterThan(0);
  expect(Object.keys(v2.best)).toHaveLength(2);

  // Rollback: point the index back at 1.1.0 (the directory was never removed). The next load uses it again.
  server.switchTo('1.1.0');
  await fresh.reload();
  await expect(fresh.getByText('played with different rules')).toBeVisible(); // now the 1.2.0 run is the stranger
  await fresh.getByRole('button', { name: 'Start a new game' }).click();
  await expect(fresh.getByRole('status')).toHaveText(/Content 1\.1\.0/);
  await expect(fresh.locator('#slots button')).toHaveCount(3);
  expect((await stored(fresh)).best[v1.gameplayHash]).toBeGreaterThan(0);
  await context.close();
});

test('a cosmetic update keeps the gameplay hash, so the saved run continues', async ({ browser, baseURL }) => {
  placed = 0;
  const context = await browser.newContext({ baseURL: baseURL! });
  const server = await host(context);
  const page = await context.newPage();
  await ready(page, './?seed=1');
  await placeOne(page);
  const before = (await stored(page)).active!;

  await server.publish(page, COSMETIC);
  server.switchTo('1.1.1');
  await ready(page, './');
  await expect(page.getByRole('status')).toHaveText(/Content 1\.1\.1/);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('#score')).toHaveText(String(before.score));
  expect((await stored(page)).active!.gameplayHash).toBe(before.gameplayHash);
  await context.close();
});
