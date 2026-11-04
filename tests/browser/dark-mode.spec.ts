import { expect, test } from '@playwright/test';
import { createGenerator } from '../../src/application/piece-source/piece-source';
import { startSession } from '../../src/application/session/session';
import { cellOrigin, logicalToClient } from '../../src/presentation/views/layout';
import { BOARD, canvasBox, expectColor, ready, rules, sample, shapeById, shapeColor, theme, VIEWPORT } from './helpers';

const center = (cell: readonly [number, number]) => {
  const [x, y] = cellOrigin(BOARD, cell);
  return [x + BOARD.pitch / 2, y + BOARD.pitch / 2] as const;
};

test('Dark mid-run repaints the page and the board, and leaves the run and its save alone', async ({ page }, info) => {
  const first = startSession(rules, 'd', createGenerator(1));
  const slot = first.tray.findIndex((s) => s);
  const shape = shapeById(first.tray[slot]!.shapeId);
  const anchor = [2, 2] as const;
  const tile = [anchor[0] + shape.cells[0]![0], anchor[1] + shape.cells[0]![1]] as const;
  const box = await ready(page, './?seed=1');
  await page.getByRole('button', { name: new RegExp(`^Slot ${slot + 1}`) }).click();
  await page.mouse.click(...logicalToClient(center(anchor), box, VIEWPORT));
  await expect(page.locator('#save-status')).toHaveText('Saved');
  const score = await page.locator('#score').textContent();
  const trayLabels = () => page.locator('#slots button').evaluateAll((b) => b.map((e) => e.getAttribute('aria-label')));
  const tray = await trayLabels();

  await page.keyboard.press('Escape');
  await page.getByRole('dialog', { name: 'Paused' }).getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('radio', { name: 'Dark', exact: true }).check();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const css = await page.evaluate(() => [getComputedStyle(document.documentElement).colorScheme, getComputedStyle(document.querySelector('dialog[open]')!).backgroundColor]);
  expect(css).toEqual(['dark', 'rgb(27, 36, 38)']);
  await page.screenshot({ path: `docs/evidence/t19a/settings-dark-${info.project.name}.png` });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Resume' }).click();
  await canvasBox(page); // rendering restarts on resume; wait for a fresh frame

  const gap = [BOARD.x + BOARD.pitch, BOARD.y + 30] as const;
  const [bg, empty, placed] = await sample(page, [gap, center([9, 9]), center(tile)].map((p) => logicalToClient(p, box, VIEWPORT)));
  expectColor(bg!, theme.dark.background, 'canvas background');
  expectColor(empty!, theme.dark.empty_cell, 'empty cell');
  expectColor(placed!, shapeColor(shape.id), 'placed tile keeps its color');
  await expect(page.locator('#score')).toHaveText(score!);
  expect(await trayLabels()).toEqual(tray);
  await page.screenshot({ path: `docs/evidence/t19a/board-dark-${info.project.name}.png` });

  // The reload continues the same run, still dark.
  await ready(page, './');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('#score')).toHaveText(score!);
});

test('Match my device follows prefers-color-scheme, also when it changes', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  const box = await ready(page, './?seed=1'); // straight into a run: no menu backdrop over the board
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const point = logicalToClient(center([9, 9]), box, VIEWPORT);
  expectColor((await sample(page, [point]))[0]!, theme.dark.empty_cell, 'empty cell, device dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await canvasBox(page);
  expectColor((await sample(page, [point]))[0]!, theme.empty_cell, 'empty cell, device light');
});

test('a chosen Light overrides a dark device', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await ready(page, './');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('radio', { name: 'Light', exact: true }).check();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});
