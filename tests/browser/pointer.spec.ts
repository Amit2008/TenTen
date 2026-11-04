import { expect, test, type Browser, type Page } from '@playwright/test';
import { createGenerator } from '../../src/application/piece-source/piece-source';
import { GameSession, startSession } from '../../src/application/session/session';
import type { Cell, SessionState } from '../../src/domain/models/types';
import { canPlace, placementCells } from '../../src/domain/placement/placement';
import { cellOrigin, logicalToClient, slotGrid, type ClientBox, type Point } from '../../src/presentation/views/layout';
import { BOARD, blend, colorDistance, canvasBox, config, expectColor, ready, rules, runtime, sample, shapeById, shapeColor, theme, TRAY, VIEWPORT } from './helpers';

const SEED = 1;
type TouchType = 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel';
const pitch = BOARD.pitch;

/** Drives one pointer: real mouse input, or CDP touch input (Chromium) so the page sees pointerType "touch". */
interface Driver {
  readonly kind: 'mouse' | 'touch';
  down(p: Point): Promise<void>;
  move(p: Point): Promise<void>;
  up(): Promise<void>;
}

const mouse = (page: Page): Driver => ({
  kind: 'mouse',
  down: async ([x, y]) => (await page.mouse.move(x, y), page.mouse.down()),
  move: ([x, y]) => page.mouse.move(x, y, { steps: 8 }),
  up: () => page.mouse.up(),
});

async function touch(page: Page): Promise<Driver & { cancel(): Promise<void> }> {
  const cdp = await page.context().newCDPSession(page);
  let at: Point = [0, 0];
  const send = (type: TouchType, points: Point[]) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y]) => ({ x, y, id: 0 })) });
  return {
    kind: 'touch',
    down: async (p) => void (await send('touchStart', [(at = p)])),
    move: async ([x, y]) => {
      const [x0, y0] = at;
      for (let i = 1; i <= 8; i++) await send('touchMove', [[x0 + ((x - x0) * i) / 8, y0 + ((y - y0) * i) / 8]]);
      at = [x, y];
    },
    up: async () => void (await send('touchEnd', [])),
    cancel: async () => void (await send('touchCancel', [])),
  };
}

/** The page's session replayed in Node with the same seed and commands. */
function mirror() {
  const session = new GameSession(rules, startSession(rules, 'mirror', createGenerator(SEED)));
  return {
    session,
    place(slot: number, anchor: Cell) {
      const s = session.state;
      const result = session.place({ type: 'PlacePiece', sessionId: s.sessionId, expectedRevision: s.revision, instanceId: s.tray[slot]!.instanceId, anchor });
      if (!result.accepted) throw new Error(`mirror rejected ${slot}@${anchor}: ${result.reason}`);
    },
  };
}

const center = (cell: Cell): Point => {
  const [x, y] = cellOrigin(BOARD, cell);
  return [x + pitch / 2, y + pitch / 2];
};

function trayCellClient(state: SessionState, slot: number, local: Cell, box: ClientBox): Point {
  const grid = slotGrid(TRAY, slot, shapeById(state.tray[slot]!.shapeId));
  const [x, y] = cellOrigin(grid, local);
  return logicalToClient([x + grid.pitch / 2, y + grid.pitch / 2], box, VIEWPORT);
}

/**
 * Pointer position that previews `anchor` for the grabbed cell. It sits 0.45 pitch right of the target cell's center
 * (still inside the cell), so the floating piece is offset and the ghost shows through the gap between its tiles.
 * Touch adds the 36 CSS px lift below the finger.
 */
function dropPoint(anchor: Cell, grabbed: Cell, box: ClientBox, kind: Driver['kind']): Point {
  const [x, y] = center([anchor[0] + grabbed[0], anchor[1] + grabbed[1]]);
  const [cx, cy] = logicalToClient([x + 0.45 * pitch, y], box, VIEWPORT);
  return kind === 'touch' ? [cx, cy + runtime.touch_lift_css_px] : [cx, cy];
}

/** Point inside each ghost cell that the offset floating piece never covers (on the invalid cross's diagonal). */
const ghostSamplePoint = ([x, y]: Cell, box: ClientBox): Point => {
  const [left, top] = cellOrigin(BOARD, [x, y]);
  return logicalToClient([left + 0.45 * pitch, top + 0.45 * pitch], box, VIEWPORT);
};

/** Every board cell center matches the mirrored state. */
async function expectBoard(page: Page, box: ClientBox, state: SessionState, what: string) {
  const cells = state.board.cells.map((_, i): Cell => [i % config.columns, Math.floor(i / config.columns)]);
  const pixels = await sample(page, cells.map((c) => logicalToClient(center(c), box, VIEWPORT)));
  cells.forEach((c, i) => {
    const tile = state.board.cells[i];
    expectColor(pixels[i]!, tile ? shapeColor(tile) : theme.empty_cell, `${what}: board cell ${c}`);
  });
  await expect(page.locator('#score')).toHaveText(String(state.score));
  for (const [i, slot] of state.tray.entries()) await expect(page.locator('#slots button').nth(i)).toBeEnabled({ enabled: slot !== null });
}

async function newPage(browser: Browser, baseURL: string, dpr: number, hasTouch = false) {
  const context = await browser.newContext({ deviceScaleFactor: dpr, viewport: { width: 800, height: 1000 }, hasTouch, baseURL });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return { context, page, errors, box: await ready(page, `./?seed=${SEED}`) };
}

for (const [kind, dpr] of [['mouse', 1], ['touch', 3]] as const) {
  test(`${kind} at DPR ${dpr}: ghost and committed cells coincide at all four board corners`, async ({ browser, baseURL }, info) => {
    test.setTimeout(90_000);
    const { context, page, errors, box } = await newPage(browser, baseURL!, dpr, kind === 'touch');
    const driver = kind === 'mouse' ? mouse(page) : await touch(page);
    const m = mirror();
    const corners = (slot: number): Cell[] => {
      const { width: w, height: h } = shapeById(m.session.state.tray[slot]!.shapeId);
      return [[0, 0], [config.columns - w, 0], [0, config.rows - h], [config.columns - w, config.rows - h]];
    };
    // Top-left, top-right and bottom-left with the first deal; bottom-right with the refill.
    const plan: [slot: number, corner: number][] = [[0, 0], [1, 1], [2, 2], [0, 3]];
    for (const [step, [slot, corner]] of plan.entries()) {
      const state = m.session.state;
      const shape = shapeById(state.tray[slot]!.shapeId);
      const anchor = corners(slot)[corner]!;
      expect(canPlace(state.board, shape, anchor), `plan step ${step} must be legal for seed ${SEED}`).toBe(true);
      const grabbed = shape.cells[0]!;
      await driver.down(trayCellClient(state, slot, grabbed, box));
      await driver.move(dropPoint(anchor, grabbed, box, kind));
      // Mid-drag: the ghost is the shape color blended over the empty cell, exactly on the cells a drop would fill.
      const placed = placementCells(shape, anchor);
      const ghost = await sample(page, placed.map((c) => ghostSamplePoint(c, box)));
      const want = blend(shapeColor(shape.id), theme.empty_cell, theme.ghost_alpha);
      placed.forEach((c, i) => expectColor(ghost[i]!, want, `step ${step} ghost at ${c}`));
      // No line would clear here, so no ghost cell may carry the accent outline (regression: a stray stroke).
      expect(m.session.state.board.cells.filter((t) => t === null).length).toBeGreaterThan(config.columns);
      const edges = await sample(page, placed.map(([x, y]) => {
        const [left, top] = cellOrigin(BOARD, [x, y]);
        return logicalToClient([left + 0.05 * pitch, top + 0.9 * pitch], box, VIEWPORT);
      }));
      edges.forEach((px, i) => expect(colorDistance(px, theme.accent), `step ${step} no outline at ${placed[i]}`).toBeGreaterThan(40));
      if (step === 3 && kind === 'mouse') await page.screenshot({ path: `docs/evidence/t14/ghost-valid-dpr${dpr}-${info.project.name}.png` });
      await driver.up();
      m.place(slot, anchor);
      await canvasBox(page);
      await expectBoard(page, box, m.session.state, `step ${step} after release`);
    }
    expect(errors).toEqual([]);
    await context.close();
  });
}
