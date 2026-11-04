import { expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createGenerator, weightedPieceSource } from '../../src/application/piece-source/piece-source';
import { startSession, type SessionRules } from '../../src/application/session/session';
import { parseGameplay } from '../../src/domain/models/gameplay-config';
import { boardLayout, trayLayout, viewportRect, type ClientBox, type Point, type Rect } from '../../src/presentation/views/layout';

// Shared by the browser specs: the shipped content, the page's layout computed in Node, and screen-pixel sampling.
export const release = (file: string) => JSON.parse(readFileSync(`public/content/releases/1.1.0/${file}`, 'utf8'));
export const { config, colorKeys } = parseGameplay(release('rules.json'), release('pieces.json'));
export const runtime = release('runtime.json');
export const theme = release('theme.json');
export const VIEWPORT = viewportRect(runtime.logical_size, runtime.board_rect);
export const BOARD = boardLayout(runtime.board_rect as Rect, config.columns, config.rows);
export const TRAY = trayLayout(runtime.tray_rect as Rect, config.traySize, config.catalog);
export const rules: SessionRules = { config, gameplayHash: 'browser-test', source: weightedPieceSource };
export const shapeById = (id: string) => config.catalog.find((c) => c.id === id)!;
export const trayFor = (seed: number) => startSession(rules, 'test', createGenerator(seed)).tray.map((s) => shapeById(s!.shapeId));
export const shapeColor = (id: string): string => theme.colors[colorKeys[id]!];

const hex = (color: string) => [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));

export async function ready(page: Page, path: string): Promise<ClientBox> {
  await page.goto(path);
  await expect(page.getByRole('status')).toHaveText(/Renderer ready/);
  return canvasBox(page);
}

/** The canvas box after two frames (the fit and the first render after it). */
export async function canvasBox(page: Page): Promise<ClientBox> {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  return page.locator('#game canvas').evaluate((c) => c.getBoundingClientRect().toJSON());
}

/** RGB of the page screenshot at CSS client points: what is actually on screen, at device-pixel resolution. */
export async function sample(page: Page, points: readonly Point[]): Promise<number[][]> {
  const png = (await page.screenshot()).toString('base64');
  return page.evaluate(
    async ({ png, points }) => {
      const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${png}`)).blob());
      const ctx = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0);
      return points.map(([x, y]) => Array.from(ctx.getImageData(Math.floor(x * devicePixelRatio), Math.floor(y * devicePixelRatio), 1, 1).data.slice(0, 3)));
    },
    { png, points },
  );
}

/** `over` blended onto `under` at `alpha` (0-255), as the ghost is drawn. */
export function blend(over: string, under: string, alpha: number): number[] {
  const [a, b] = [hex(over), hex(under)];
  return a.map((v, i) => Math.round((v * alpha + b[i]! * (255 - alpha)) / 255));
}

/** Largest per-channel difference. */
export function colorDistance(actual: number[], expected: string | number[]): number {
  const want = typeof expected === 'string' ? hex(expected) : expected;
  return Math.max(...want.map((v, i) => Math.abs(v - actual[i]!)));
}

export function expectColor(actual: number[], expected: string | number[], what: string) {
  expect(colorDistance(actual, expected), `${what}: got rgb(${actual}) want ${expected}`).toBeLessThanOrEqual(6);
}
