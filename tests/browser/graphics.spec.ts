import { expect, test, type Page } from '@playwright/test';
import { createGenerator } from '../../src/application/piece-source/piece-source';
import { startSession } from '../../src/application/session/session';
import { cellOrigin, logicalToClient, slotGrid } from '../../src/presentation/views/layout';
import { BOARD, canvasBox, expectColor, ready, rules, runtime, sample, shapeById, TRAY, theme, VIEWPORT } from './helpers';

const center = (grid: typeof BOARD, cell: readonly [number, number]) => {
  const [x, y] = cellOrigin(grid, cell);
  return [x + grid.pitch / 2, y + grid.pitch / 2] as const;
};
const fontStatus = (page: Page) =>
  page.evaluate(() => [...document.fonts].filter((f) => f.family.includes('Atkinson')).map((f) => `${f.weight} ${f.status}`).sort());

/** Places seed 1's first piece at (2,2) and returns where its first tile landed plus another filled slot. */
async function placeFirst(page: Page) {
  const first = startSession(rules, 'g', createGenerator(1));
  const slot = first.tray.findIndex((s) => s);
  const shape = shapeById(first.tray[slot]!.shapeId);
  const box = await ready(page, './?seed=1');
  await page.getByRole('button', { name: new RegExp(`^Slot ${slot + 1}`) }).click();
  await page.mouse.click(...logicalToClient(center(BOARD, [2, 2]), box, VIEWPORT));
  await expect(page.locator('#save-status')).toHaveText('Saved');
  const other = first.tray.findIndex((s, i) => s && i !== slot);
  const otherShape = shapeById(first.tray[other]!.shapeId);
  return { box, other, tile: [2 + shape.cells[0]![0], 2 + shape.cells[0]![1]] as const, trayTile: center(slotGrid(TRAY, other, otherShape), otherShape.cells[0]!) };
}

async function chooseTheme(page: Page, name: string) {
  await page.keyboard.press('Escape');
  await page.getByRole('dialog', { name: 'Paused' }).getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('radio', { name, exact: true }).check();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Resume' }).click();
  return canvasBox(page); // rendering restarts on resume; wait for a fresh frame
}

test('the bundled font is in before the game reports ready, even when it arrives late', async ({ page }) => {
  await page.route('**/*.woff2', async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  });
  await ready(page, './');
  expect(await fontStatus(page)).toEqual(['400 loaded', '700 loaded']);
  expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toMatch(/^"Atkinson Hyperlegible"/);
});

test('a missing font falls back to system fonts and the game still plays', async ({ page }) => {
  await page.route('**/*.woff2', (route) => route.abort());
  await ready(page, './');
  expect(await fontStatus(page)).toEqual(['400 error', '700 error']);
  await page.getByRole('button', { name: 'New game' }).click();
  await expect(page.locator('#score')).toHaveText('0');
  await expect(page.locator('#slots button')).toHaveCount(3);
});

test('High contrast paints one dark tile color on light cells, board and tray', async ({ page }) => {
  const { tile, trayTile } = await placeFirst(page);
  const box = await chooseTheme(page, 'High contrast');
  const hc = theme.high_contrast;
  const gap = [BOARD.x + BOARD.pitch, BOARD.y + 30] as const;
  const [bg, empty, placed, tray] = await sample(page, [gap, center(BOARD, [9, 9]), center(BOARD, tile), trayTile].map((p) => logicalToClient(p, box, VIEWPORT)));
  expectColor(bg!, hc.background, 'canvas background');
  expectColor(empty!, hc.empty_cell, 'empty cell');
  expectColor(placed!, hc.tile, 'placed tile');
  expectColor(tray!, hc.tile, 'tray tile');

  // Back to Light: tiles get their decorative colors again without a reload.
  const light = await chooseTheme(page, 'Light');
  const [again] = await sample(page, [logicalToClient(center(BOARD, [9, 9]), light, VIEWPORT)]);
  expectColor(again!, theme.empty_cell, 'empty cell after Light');
});

test('the pause button pauses and Resume returns to the board', async ({ page }) => {
  await ready(page, './?seed=1');
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(page.getByRole('dialog', { name: 'Paused' })).toBeVisible();
  await expect(page.locator('#pause-button')).toHaveJSProperty('inert', true);
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(page.getByRole('dialog', { name: 'Paused' })).toBeHidden();
  await expect(page.locator('#pause-button')).toHaveJSProperty('inert', false);
});

/** Visible text that overflows its box, leaves the viewport sideways or is cut off by the game area's overflow. */
function clippedLabels(): string[] {
  const bad: string[] = [];
  const width = document.documentElement.clientWidth;
  if (document.documentElement.scrollWidth > width) bad.push(`page scrolls sideways (${document.documentElement.scrollWidth} > ${width})`);
  for (const el of document.querySelectorAll<HTMLElement>('button, label, legend, h2, h3, p, li, output, summary, strong, a')) {
    const text = el.textContent?.replace(/\s+/g, ' ').trim() || el.getAttribute('aria-label');
    if (!text || !el.checkVisibility() || el.closest('.visually-hidden')) continue;
    const name = `${el.tagName.toLowerCase()} "${text.slice(0, 40)}"`;
    const r = el.getBoundingClientRect();
    if (el.scrollWidth > el.clientWidth + 1) bad.push(`${name} overflows its box`);
    if (r.left < -0.5 || r.right > width + 0.5) bad.push(`${name} leaves the viewport`);
    const game = el.closest('#game')?.getBoundingClientRect();
    if (game && (r.top < game.top - 0.5 || r.bottom > game.bottom + 0.5)) bad.push(`${name} is cut off by the game area`);
  }
  return bad;
}

test('no label is clipped at the smallest supported view and DPR 3', async ({ browser, baseURL }, info) => {
  const [width, height] = runtime.minimum_viewport_css as [number, number];
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 3, baseURL: baseURL! });
  const page = await context.newPage();
  const shot = (name: string) => info.project.name === 'root' && page.screenshot({ path: `docs/evidence/t21/min-${name}.png` });
  const check = async (where: string) => expect(await page.evaluate(clippedLabels), where).toEqual([]);

  await ready(page, './');
  await page.getByRole('button', { name: 'New game' }).click();
  await check('game');
  await page.getByRole('button', { name: 'Pause' }).click();
  await check('pause');
  await page.getByRole('dialog', { name: 'Paused' }).getByRole('button', { name: 'Restart' }).click();
  await check('confirm new game');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Pause' }).click();
  await page.getByRole('button', { name: 'Main menu' }).click();
  await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible(); // the tallest menu
  await check('menu');
  await shot('menu');
  for (const dialog of ['How to play', 'Settings', 'Credits']) {
    await page.getByRole('dialog', { name: 'Line Garden' }).getByRole('button', { name: dialog }).click();
    await expect(page.getByRole('dialog', { name: dialog })).toBeVisible();
    await check(dialog);
    if (dialog === 'Settings') await shot('settings');
    await page.keyboard.press('Escape');
  }
  await context.close();
});

// Approval screenshots: the three canvas themes at the smallest view (DPR 3) with a placed piece and a selection.
for (const [label, radio] of [['light', 'Light'], ['dark', 'Dark'], ['high-contrast', 'High contrast']] as const)
  test(`screenshot: ${label} at the smallest view`, async ({ browser, baseURL }, info) => {
    test.skip(info.project.name !== 'root', 'one set of screenshots is enough');
    const [width, height] = runtime.minimum_viewport_css as [number, number];
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 3, baseURL: baseURL! });
    const page = await context.newPage();
    const { other } = await placeFirst(page);
    await chooseTheme(page, radio);
    await page.getByRole('button', { name: new RegExp(`^Slot ${other + 1}`) }).click();
    await canvasBox(page);
    await page.screenshot({ path: `docs/evidence/t21/board-${label}.png` });
    await context.close();
  });
