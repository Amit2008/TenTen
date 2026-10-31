import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createGenerator, weightedPieceSource } from '../../src/application/piece-source/piece-source';
import { startSession } from '../../src/application/session/session';
import { parseGameplay } from '../../src/domain/models/gameplay-config';
import type { ShapeDefinition } from '../../src/domain/models/types';
import {
  boardLayout,
  cellAt,
  cellOrigin,
  clientToLogical,
  logicalToClient,
  slotGrid,
  trayLayout,
  viewportRect,
  type ClientBox,
  type Point,
  type Rect,
} from '../../src/presentation/views/layout';

const release = (file: string) => JSON.parse(readFileSync(`public/content/releases/1.1.0/${file}`, 'utf8'));
const { config, colorKeys } = parseGameplay(release('rules.json'), release('pieces.json'));
const runtime = release('runtime.json');
const theme = release('theme.json');
const VIEWPORT = viewportRect(runtime.logical_size, runtime.board_rect);
const BOARD = boardLayout(runtime.board_rect as Rect, config.columns, config.rows);
const TRAY = trayLayout(runtime.tray_rect as Rect, config.traySize, config.catalog);
const rules = { config, gameplayHash: 'layout-test', source: weightedPieceSource };
const trayFor = (seed: number) =>
  startSession(rules, 'layout', createGenerator(seed)).tray.map((s) => config.catalog.find((c) => c.id === s!.shapeId)!);

// The smallest seeds whose first deals together show all 19 shapes, found with the same session code the page runs.
const SEEDS: number[] = [];
for (const seen = new Set<string>(); seen.size < config.catalog.length; ) {
  const seed = SEEDS.length ? SEEDS.at(-1)! + 1 : 1;
  let s = seed;
  while (trayFor(s).every((shape) => seen.has(shape.id))) s++;
  trayFor(s).forEach((shape) => seen.add(shape.id));
  SEEDS.push(s);
}

const hex = (color: string) => [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));

async function ready(page: Page, path: string): Promise<ClientBox> {
  await page.goto(path);
  await expect(page.getByRole('status')).toHaveText(/Renderer ready/);
  // Two frames: the fit and the first render after it.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  return page.locator('#game canvas').evaluate((c) => c.getBoundingClientRect().toJSON());
}

/** RGB of the page screenshot at CSS client points: what is actually on screen, at device-pixel resolution. */
async function sample(page: Page, points: readonly Point[]): Promise<number[][]> {
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

function expectColor(actual: number[], expected: string, what: string) {
  const want = hex(expected);
  const off = Math.max(...want.map((v, i) => Math.abs(v - actual[i]!)));
  expect(off, `${what}: got rgb(${actual}) want ${expected}`).toBeLessThanOrEqual(6);
}

for (const dpr of [1, 2, 3]) {
  test(`all ${config.catalog.length} pieces render at DPR ${dpr} where the logical mapping puts them`, async ({ browser, baseURL }, info) => {
    const context = await browser.newContext({ deviceScaleFactor: dpr, viewport: { width: 800, height: 1000 }, baseURL: baseURL! });
    const page = await context.newPage();
    const rendered = new Set<string>();
    for (const seed of SEEDS) {
      const box = await ready(page, `./?seed=${seed}`);
      const tray = trayFor(seed);
      const checks: { point: Point; color: string; what: string }[] = [];
      tray.forEach((shape: ShapeDefinition, slot) => {
        const grid = slotGrid(TRAY, slot, shape);
        for (let y = 0; y < shape.height; y++)
          for (let x = 0; x < shape.width; x++) {
            const [ox, oy] = cellOrigin(grid, [x, y]);
            const filled = shape.cells.some(([cx, cy]) => cx === x && cy === y);
            checks.push({
              point: logicalToClient([ox + grid.pitch / 2, oy + grid.pitch / 2], box, VIEWPORT),
              color: filled ? theme.colors[colorKeys[shape.id]!] : theme.background,
              what: `seed ${seed} slot ${slot + 1} ${shape.id} local (${x},${y})`,
            });
          }
        rendered.add(shape.id);
      });
      // Empty board cells, the gap between cells and the letterbox-free margin left of the board.
      for (const cell of [[0, 0], [9, 0], [0, 9], [9, 9], [4, 5]] as const) {
        const [ox, oy] = cellOrigin(BOARD, cell);
        const center = logicalToClient([ox + 30, oy + 30], box, VIEWPORT);
        checks.push({ point: center, color: theme.empty_cell, what: `board cell ${cell}` });
        // Pointer inversion through the real canvas box lands back in the same cell.
        expect(cellAt(BOARD, clientToLogical(center, box, VIEWPORT))).toEqual(cell);
      }
      checks.push({ point: logicalToClient([BOARD.x + BOARD.pitch, BOARD.y + 30], box, VIEWPORT), color: theme.background, what: 'gap between cells' });
      checks.push({ point: logicalToClient([30, 500], box, VIEWPORT), color: theme.background, what: 'left margin' });

      const pixels = await sample(page, checks.map((c) => c.point));
      checks.forEach((c, i) => expectColor(pixels[i]!, c.color, c.what));
      // The DOM slot buttons describe the same deal the canvas shows.
      for (const [i, shape] of tray.entries())
        await expect(page.locator('#slots button').nth(i)).toHaveAccessibleName(
          `Slot ${i + 1}: ${shape.cells.length} cells, ${shape.width} wide by ${shape.height} tall`,
        );
      if (seed === SEEDS[0]) await page.screenshot({ path: `docs/evidence/t13/pieces-dpr${dpr}-${info.project.name}.png` });
    }
    expect([...rendered].sort()).toEqual(config.catalog.map((s) => s.id).sort());
    console.log(`[${info.project.name}] DPR ${dpr}: seeds ${SEEDS.join(',')} rendered all ${rendered.size} shapes`);
    await context.close();
  });
}

const VIEWPORTS = [
  { name: 'phone-360x640', width: 360, height: 640, dpr: 3 },
  { name: 'phone-landscape-844x390', width: 844, height: 390, dpr: 3 },
  { name: 'desktop-1280x720', width: 1280, height: 720, dpr: 1 },
  { name: 'desktop-1920x1080', width: 1920, height: 1080, dpr: 1 },
  { name: 'tablet-1024x768', width: 1024, height: 768, dpr: 2 },
];

for (const vp of VIEWPORTS) {
  test(`layout fits ${vp.name} with no cropped controls`, async ({ browser, baseURL }, info) => {
    const context = await browser.newContext({ deviceScaleFactor: vp.dpr, viewport: vp, baseURL: baseURL! });
    const page = await context.newPage();
    await ready(page, './?seed=1');
    const boxes = await page.evaluate(() => {
      const rect = (el: Element) => el.getBoundingClientRect().toJSON() as DOMRect;
      const scroll = { x: scrollX, y: scrollY };
      return {
        canvas: rect(document.querySelector('#game canvas')!),
        score: rect(document.getElementById('score-line')!),
        buttons: [...document.querySelectorAll('#slots button')].map(rect),
        page: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight, client: document.documentElement.clientWidth },
        scroll,
      };
    });
    // No horizontal overflow anywhere; vertical scrolling is allowed only when the viewport is too short (GDD 7.2).
    expect(boxes.page.width).toBeLessThanOrEqual(boxes.page.client);
    const inside = (r: DOMRect) => {
      expect(r.left).toBeGreaterThanOrEqual(0);
      expect(r.right).toBeLessThanOrEqual(vp.width);
      expect(r.top).toBeGreaterThanOrEqual(0);
      expect(r.bottom).toBeLessThanOrEqual(boxes.page.height);
    };
    [boxes.canvas, boxes.score, ...boxes.buttons].forEach(inside);
    expect(boxes.score.bottom).toBeLessThanOrEqual(boxes.canvas.top + 0.5);
    expect(boxes.buttons).toHaveLength(config.traySize);
    for (const b of boxes.buttons) {
      expect(b.width).toBeGreaterThanOrEqual(44);
      expect(b.height).toBeGreaterThanOrEqual(44);
      expect(b.top).toBeGreaterThanOrEqual(boxes.canvas.bottom - 0.5);
    }
    // Square cells: the canvas keeps the viewport aspect ratio.
    expect(Math.abs(boxes.canvas.width / boxes.canvas.height - VIEWPORT[2] / VIEWPORT[3])).toBeLessThan(0.01);
    if (vp.name === 'phone-360x640') expect(boxes.page.height).toBeLessThanOrEqual(vp.height);
    const cell = (boxes.canvas.width * BOARD.pitch) / VIEWPORT[2];
    console.log(`[${info.project.name}] ${vp.name}: canvas ${boxes.canvas.width}x${boxes.canvas.height} CSS px, board cell ${cell.toFixed(1)} CSS px, page height ${boxes.page.height}`);
    await page.screenshot({ path: `docs/evidence/t13/layout-${vp.name}-${info.project.name}.png`, fullPage: true });
    await context.close();
  });
}
