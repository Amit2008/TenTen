import { expect, test, type Browser, type Page } from '@playwright/test';
import { createGenerator } from '../../src/application/piece-source/piece-source';
import { GameSession, startSession } from '../../src/application/session/session';
import type { Cell, SessionState } from '../../src/domain/models/types';
import { cellOrigin, logicalToClient, slotGrid, type ClientBox, type Point } from '../../src/presentation/views/layout';
import { BOARD, canvasBox, config, expectColor, ready, rules, sample, shapeById, shapeColor, theme, TRAY, VIEWPORT } from './helpers';

const SEED = 1;
const pitch = BOARD.pitch;
const first = () => startSession(rules, 'mirror', createGenerator(SEED));
const SHAPE = shapeById(first().tray[0]!.shapeId);

const boardClient = ([x, y]: Cell, box: ClientBox, dx = 0.5, dy = 0.5): Point => {
  const [left, top] = cellOrigin(BOARD, [x, y]);
  return logicalToClient([left + dx * pitch, top + dy * pitch], box, VIEWPORT);
};
const slotClient = (state: SessionState, slot: number, local: Cell, box: ClientBox): Point => {
  const grid = slotGrid(TRAY, slot, shapeById(state.tray[slot]!.shapeId));
  const [x, y] = cellOrigin(grid, local);
  return logicalToClient([x + grid.pitch / 2, y + grid.pitch / 2], box, VIEWPORT);
};

async function open(browser: Browser, baseURL: string, opts: { hasTouch?: boolean; height?: number } = {}) {
  const context = await browser.newContext({ viewport: { width: 800, height: opts.height ?? 1000 }, hasTouch: !!opts.hasTouch, baseURL });
  const page = await context.newPage();
  return { context, page, box: await ready(page, `./?seed=${SEED}`) };
}

async function expectBoard(page: Page, box: ClientBox, state: SessionState, what: string) {
  await canvasBox(page);
  const cells = state.board.cells.map((_, i): Cell => [i % config.columns, Math.floor(i / config.columns)]);
  const pixels = await sample(page, cells.map((c) => boardClient(c, box)));
  cells.forEach((c, i) => {
    const tile = state.board.cells[i];
    expectColor(pixels[i]!, tile ? shapeColor(tile) : theme.empty_cell, `${what}: cell ${c}`);
  });
  await expect(page.locator('#score')).toHaveText(String(state.score));
}

/** Focus the canvas with the keyboard, the way a keyboard player would. */
async function tabToCanvas(page: Page) {
  for (let i = 0; i < 10 && !(await page.evaluate(() => document.activeElement?.tagName === 'CANVAS')); i++) await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('CANVAS');
}

test('the seed deals an empty-origin shape first', () => {
  expect(SHAPE.cells.some(([x, y]) => x === 0 && y === 0)).toBe(false);
});

for (const anchor of [[0, 0], [config.columns - SHAPE.width, config.rows - SHAPE.height], [4, 2]] as Cell[]) {
  test(`mouse, touch and keyboard place ${SHAPE.id} in identical cells at anchor ${anchor}`, async ({ browser, baseURL }, info) => {
    const expected = new GameSession(rules, first());
    const s = expected.state;
    expected.place({ type: 'PlacePiece', sessionId: s.sessionId, expectedRevision: 0, instanceId: s.tray[0]!.instanceId, anchor });

    // Mouse: the slot button, then a click on the anchor cell.
    const mouse = await open(browser, baseURL!);
    await mouse.page.getByRole('button', { name: /^Slot 1/ }).click();
    await expect(mouse.page.getByRole('button', { name: /^Slot 1/ })).toHaveAttribute('aria-pressed', 'true');
    await mouse.page.mouse.click(...boardClient(anchor, mouse.box));
    await expectBoard(mouse.page, mouse.box, expected.state, 'mouse');
    await mouse.context.close();

    // Touch: tap the piece in the tray, then tap the anchor cell (CDP touch, so pointerType is "touch").
    const touch = await open(browser, baseURL!, { hasTouch: true });
    const cdp = await touch.context.newCDPSession(touch.page);
    const tap = async ([x, y]: Point) => {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    await tap(slotClient(s, 0, SHAPE.cells[0]!, touch.box));
    await tap(boardClient(anchor, touch.box));
    await expectBoard(touch.page, touch.box, expected.state, 'touch');
    await touch.context.close();

    // Keyboard: Tab to the board, 1, arrows from the centered start, Enter.
    const keys = await open(browser, baseURL!);
    await tabToCanvas(keys.page);
    await keys.page.keyboard.press('1');
    const start = [Math.floor((config.columns - SHAPE.width) / 2), Math.floor((config.rows - SHAPE.height) / 2)];
    for (let i = 0; i < Math.abs(anchor[0] - start[0]!); i++) await keys.page.keyboard.press(anchor[0] < start[0]! ? 'ArrowLeft' : 'ArrowRight');
    for (let i = 0; i < Math.abs(anchor[1] - start[1]!); i++) await keys.page.keyboard.press(anchor[1] < start[1]! ? 'ArrowUp' : 'ArrowDown');
    // The marker ring sits on the anchor cell even though that cell of the shape is empty.
    const [ring] = await sample(keys.page, [boardClient(anchor, keys.box, 0.5 + 0.22, 0.5)]);
    expectColor(ring!, theme.text, `anchor marker at ${anchor}`);
    if (anchor[0] === 0 && anchor[1] === 0) await keys.page.screenshot({ path: `docs/evidence/t15/keyboard-anchor-${info.project.name}.png` });
    await keys.page.keyboard.press('Enter');
    await expectBoard(keys.page, keys.box, expected.state, 'keyboard');
    await expect(keys.page.locator('#slots button[aria-pressed="true"]')).toHaveCount(0);
    await keys.context.close();
  });
}

test('a held Enter commits once', async ({ browser, baseURL }) => {
  const { context, page, box } = await open(browser, baseURL!);
  await tabToCanvas(page);
  const m = new GameSession(rules, first());
  const s = m.state;
  const third = shapeById(s.tray[2]!.shapeId);
  const centered: Cell = [Math.floor((config.columns - third.width) / 2), Math.floor((config.rows - third.height) / 2)];
  await page.keyboard.press('3');
  await page.keyboard.down('Enter'); // commits slot 3 at the centered anchor
  await page.keyboard.press('2');
  await page.keyboard.press('ArrowRight'); // slot 2 kept the same anchor; step it off slot 3's cells
  await page.keyboard.down('Enter'); // still held: a repeat, ignored
  await page.keyboard.up('Enter');
  m.place({ type: 'PlacePiece', sessionId: s.sessionId, expectedRevision: 0, instanceId: s.tray[2]!.instanceId, anchor: centered });
  // Slot 2 is still selected (its ghost is on the board) and was not placed; Escape clears the ghost.
  await expect(page.getByRole('button', { name: /^Slot 2/ })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expectBoard(page, box, m.state, 'held Enter');
  await context.close();
});

test('only handled puzzle keys are prevented; Tab, shortcuts and scrolling stay with the browser', async ({ browser, baseURL }) => {
  const { context, page } = await open(browser, baseURL!, { height: 300 }); // short: the page itself scrolls
  await page.evaluate(() => {
    (window as unknown as { seen: string[] }).seen = [];
    document.addEventListener('keydown', (e) => (window as unknown as { seen: string[] }).seen.push(`${e.key}:${e.defaultPrevented}`));
  });
  const seen = async () => page.evaluate(() => (window as unknown as { seen: string[] }).seen.splice(0));
  await tabToCanvas(page);
  await seen();
  await page.keyboard.press('ArrowDown'); // nothing selected: the page scrolls
  await page.keyboard.press('Control+1'); // a browser shortcut chord
  await page.keyboard.press('4'); // beyond the tray size
  expect(await seen()).toEqual(['ArrowDown:false', 'Control:false', '1:false', '4:false']);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0); // smooth scrolling is asynchronous
  await page.keyboard.press('Escape'); // nothing selected: opens pause (T16), so it is handled
  expect(await seen()).toEqual(['Escape:true']);
  await page.getByRole('button', { name: 'Resume' }).click();
  await seen();
  await page.keyboard.press('1');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Escape');
  expect(await seen()).toEqual(['1:true', 'ArrowDown:true', 'Escape:true']);
  // Tab still leaves the canvas, and arrows on a focused slot button are not puzzle keys.
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement?.textContent)).toBe('1');
  await page.keyboard.press('ArrowRight');
  expect(await seen()).toEqual(['Tab:false', 'ArrowRight:false']);
  await context.close();
});

test('a slot button moves focus to the board; a drag replaces the selection', async ({ browser, baseURL }) => {
  const { context, page, box } = await open(browser, baseURL!);
  const s = first();
  await page.getByRole('button', { name: /^Slot 1/ }).click();
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('CANVAS');
  const grabbed = shapeById(s.tray[2]!.shapeId).cells[0]!;
  await page.mouse.move(...slotClient(s, 2, grabbed, box));
  await page.mouse.down();
  await page.mouse.move(...boardClient([6 + grabbed[0], 2 + grabbed[1]], box), { steps: 8 });
  await expect(page.locator('#slots button[aria-pressed="true"]')).toHaveCount(0);
  await page.mouse.up();
  await expect(page.locator('#score')).toHaveText(String(shapeById(s.tray[2]!.shapeId).cells.length));
  await context.close();
});
