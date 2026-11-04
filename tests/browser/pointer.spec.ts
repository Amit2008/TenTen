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

for (const [kind, dpr] of [['mouse', 1], ['mouse', 2], ['mouse', 3], ['touch', 1], ['touch', 3]] as const) {
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

test('after an orientation change a touch drag previews and places on the same cells (T20)', async ({ browser, baseURL }) => {
  const { context, page, errors } = await newPage(browser, baseURL!, 3, true);
  const driver = await touch(page);
  const m = mirror();
  // Landscape then back to portrait; top-left and top-right corners are legal for this deal (see the corner test).
  for (const [slot, size] of [[0, { width: 1000, height: 800 }], [1, { width: 800, height: 1000 }]] as const) {
    await page.setViewportSize(size);
    await page.evaluate(() => screen.orientation.dispatchEvent(new Event('change')));
    const box = await canvasBox(page);
    const state = m.session.state;
    const shape = shapeById(state.tray[slot]!.shapeId);
    const anchor: Cell = slot === 0 ? [0, 0] : [config.columns - shape.width, 0];
    expect(canPlace(state.board, shape, anchor)).toBe(true);
    const grabbed = shape.cells[0]!;
    await driver.down(trayCellClient(state, slot, grabbed, box));
    await driver.move(dropPoint(anchor, grabbed, box, 'touch'));
    const placed = placementCells(shape, anchor);
    const ghost = await sample(page, placed.map((c) => ghostSamplePoint(c, box)));
    const want = blend(shapeColor(shape.id), theme.empty_cell, theme.ghost_alpha);
    placed.forEach((c, i) => expectColor(ghost[i]!, want, `${size.width}x${size.height} ghost at ${c}`));
    await driver.up();
    m.place(slot, anchor);
    await canvasBox(page);
    await expectBoard(page, box, m.session.state, `${size.width}x${size.height} after lift`);
  }
  expect(errors).toEqual([]);
  await context.close();
});

test('an invalid spot shows an outline and cross, and releasing there consumes nothing', async ({ browser, baseURL }, info) => {
  const { context, page, box } = await newPage(browser, baseURL!, 2);
  const driver = mouse(page);
  const m = mirror();
  const first = shapeById(m.session.state.tray[0]!.shapeId);
  await driver.down(trayCellClient(m.session.state, 0, first.cells[0]!, box));
  await driver.move(dropPoint([0, 0], first.cells[0]!, box, 'mouse'));
  await driver.up();
  m.place(0, [0, 0]);
  // Drag the next piece onto the occupied corner.
  const next = shapeById(m.session.state.tray[1]!.shapeId);
  const grabbed = next.cells[0]!;
  await driver.down(trayCellClient(m.session.state, 1, grabbed, box));
  await driver.move(dropPoint([0, 0], grabbed, box, 'mouse'));
  const covered = placementCells(next, [0, 0]);
  const pixels = await sample(page, covered.map((c) => ghostSamplePoint(c, box)));
  covered.forEach((c, i) => expectColor(pixels[i]!, theme.invalid, `invalid cross at ${c}`));
  await page.screenshot({ path: `docs/evidence/t14/ghost-invalid-${info.project.name}.png` });
  await driver.up();
  await canvasBox(page);
  await expectBoard(page, box, m.session.state, 'after invalid release');
  await context.close();
});

const CANCELS: [string, (page: Page) => Promise<unknown>][] = [
  ['window blur', (page) => page.evaluate(() => dispatchEvent(new Event('blur')))],
  [
    'hidden tab',
    (page) =>
      page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
        document.dispatchEvent(new Event('visibilitychange'));
      }),
  ],
  ['resize', (page) => page.setViewportSize({ width: 780, height: 1000 })],
  ['orientation change', (page) => page.evaluate(() => screen.orientation.dispatchEvent(new Event('change')))],
  [
    'pointer capture loss',
    (page) => page.evaluate(() => {
      const canvas = document.querySelector('#game canvas')!;
      for (let id = 0; id < 4; id++) if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    }),
  ],
];

for (const [name, trigger] of CANCELS)
  test(`${name} during a drag cancels it; the later release over a legal cell consumes nothing`, async ({ browser, baseURL }) => {
    const { context, page, box } = await newPage(browser, baseURL!, 1);
    const driver = mouse(page);
    const state = mirror().session.state;
    const grabbed = shapeById(state.tray[0]!.shapeId).cells[0]!;
    await driver.down(trayCellClient(state, 0, grabbed, box));
    await driver.move(dropPoint([3, 3], grabbed, box, 'mouse'));
    await trigger(page);
    await driver.move(dropPoint([4, 4], grabbed, box, 'mouse'));
    await driver.up();
    // Blur and a hidden tab also pause the game (T16); come back before reading the board.
    if (await page.locator('#paused').isVisible()) {
      await page.evaluate(() => Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }));
      await page.getByRole('button', { name: 'Resume' }).click();
      await canvasBox(page); // rendering was stopped while paused: wait for the first frames after Resume
    }
    await expectBoard(page, box, state, name);
    // The piece is back in the tray.
    const [pixel] = await sample(page, [trayCellClient(state, 0, grabbed, await canvasBox(page))]);
    expectColor(pixel!, shapeColor(state.tray[0]!.shapeId), 'piece back in tray');
    await context.close();
  });

test('release outside the canvas consumes nothing', async ({ browser, baseURL }) => {
  const { context, page, box } = await newPage(browser, baseURL!, 1);
  const driver = mouse(page);
  const state = mirror().session.state;
  await driver.down(trayCellClient(state, 0, shapeById(state.tray[0]!.shapeId).cells[0]!, box));
  await driver.move([5, 5]);
  await driver.up();
  await expectBoard(page, box, state, 'outside release');
  await context.close();
});

test('touch pointercancel consumes nothing', async ({ browser, baseURL }) => {
  const { context, page, box } = await newPage(browser, baseURL!, 1, true);
  const driver = await touch(page);
  const state = mirror().session.state;
  const grabbed = shapeById(state.tray[0]!.shapeId).cells[0]!;
  await driver.down(trayCellClient(state, 0, grabbed, box));
  await driver.move(dropPoint([3, 3], grabbed, box, 'touch'));
  await driver.cancel();
  await expectBoard(page, box, state, 'touch cancel');
  await context.close();
});

test('a second finger is ignored while the first drags', async ({ browser, baseURL }) => {
  const { context, page, box } = await newPage(browser, baseURL!, 1, true);
  const cdp = await context.newCDPSession(page);
  const send = (type: TouchType, points: [number, Point][]) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([id, [x, y]]) => ({ id, x, y })) });
  const m = mirror();
  const state = m.session.state;
  const grabA = shapeById(state.tray[0]!.shapeId).cells[0]!;
  const grabB = shapeById(state.tray[2]!.shapeId).cells[0]!;
  const a0 = trayCellClient(state, 0, grabA, box);
  const a1 = dropPoint([2, 2], grabA, box, 'touch');
  const b0 = trayCellClient(state, 2, grabB, box);
  const b1 = dropPoint([6, 2], grabB, box, 'touch');
  await send('touchStart', [[0, a0]]);
  await send('touchMove', [[0, [a0[0], a0[1] - 20]]]);
  await send('touchStart', [[0, [a0[0], a0[1] - 20]], [1, b0]]);
  await send('touchMove', [[0, [a0[0], a0[1] - 20]], [1, b1]]);
  // CDP touchEnd releases every finger; a touchMove that omits finger B lifts only B, over a legal spot.
  await send('touchMove', [[0, [a0[0], a0[1] - 20]]]);
  await send('touchMove', [[0, a1]]);
  await send('touchEnd', []);
  m.place(0, [2, 2]);
  await canvasBox(page);
  await expectBoard(page, box, m.session.state, 'two fingers');
  await context.close();
});

test('a drag never produces a click; a plain tap still does', async ({ browser, baseURL }) => {
  const { context, page, box } = await newPage(browser, baseURL!, 1);
  await page.evaluate(() => {
    (window as unknown as { clicks: number }).clicks = 0;
    document.querySelector('#game canvas')!.addEventListener('click', () => (window as unknown as { clicks: number }).clicks++);
  });
  const clicks = () => page.evaluate(() => (window as unknown as { clicks: number }).clicks);
  const driver = mouse(page);
  const state = mirror().session.state;
  const grabbed = shapeById(state.tray[2]!.shapeId).cells[0]!;
  await driver.down(trayCellClient(state, 2, grabbed, box));
  await driver.move(dropPoint([5, 5], grabbed, box, 'mouse'));
  await driver.up();
  await expect(page.locator('#score')).not.toHaveText('0');
  expect(await clicks()).toBe(0);
  // Invalid drop (onto the tray area): still a drag, still no click.
  const g0 = shapeById(state.tray[0]!.shapeId).cells[0]!;
  await driver.down(trayCellClient(state, 0, g0, box));
  await driver.move(trayCellClient(state, 1, [0, 0], box));
  await driver.up();
  expect(await clicks()).toBe(0);
  // Taps: on a tray piece (claimed but under the threshold) and on the board.
  await page.mouse.click(...trayCellClient(state, 0, g0, box));
  await page.mouse.click(...logicalToClient(center([8, 8]), box, VIEWPORT));
  expect(await clicks()).toBe(2);
  await context.close();
});
