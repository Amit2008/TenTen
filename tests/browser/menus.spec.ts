import { expect, test, type Page } from '@playwright/test';
import { createGenerator } from '../../src/application/piece-source/piece-source';
import { startSession } from '../../src/application/session/session';
import { cellOrigin, logicalToClient } from '../../src/presentation/views/layout';
import { BOARD, canvasBox, colorDistance, ready, rules, sample, shapeById, theme, VIEWPORT } from './helpers';

/** What has keyboard focus, and whether it shows a visible focus ring. */
const focused = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement;
    const cs = getComputedStyle(el);
    const label = el.getAttribute('aria-label') ?? (el as HTMLInputElement).labels?.[0]?.textContent ?? el.textContent ?? '';
    return { name: label.trim().replace(/\s+/g, ' '), ring: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2 };
  });

test('first load by keyboard: every menu control shows focus, and each dialog opens, closes and returns focus', async ({ page }, info) => {
  await ready(page, './');
  const menu = page.getByRole('dialog', { name: 'Line Garden' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('button', { name: 'New game' })).toBeFocused();
  // Tab through the menu: every stop is a labeled control with a visible ring.
  const stops: string[] = [];
  for (let i = 0; i < 4; i++) {
    const f = await focused(page);
    expect(f.ring, `focus ring on "${f.name}"`).toBe(true);
    stops.push(f.name);
    await page.keyboard.press('Tab');
  }
  expect(stops).toEqual(['New game', 'How to play', 'Settings', 'Credits']);

  for (const [button, title] of [['How to play', 'How to play'], ['Credits', 'Credits'], ['Settings', 'Settings']] as const) {
    await menu.getByRole('button', { name: button }).focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: title });
    await expect(dialog).toBeVisible();
    await page.screenshot({ path: `docs/evidence/t19/${button.toLowerCase().replace(/ /g, '-')}-${info.project.name}.png` });
    // Tab through the open dialog: every stop is a labeled control with a visible ring. Past the last one the
    // browser takes focus to its own UI (activeElement becomes body); the page behind stays inert, never focused.
    const visited: string[] = [];
    for (let i = 0; i < 15; i++) {
      if (i > 0) await page.keyboard.press('Tab'); // the first stop is where showModal() put focus
      const where = await dialog.evaluate((d) => (d.contains(document.activeElement) ? 'dialog' : document.activeElement === document.body ? 'body' : 'page'));
      expect(where, `focus after ${visited.join(' > ')}`).not.toBe('page');
      if (where === 'body') break;
      const f = await focused(page);
      expect(f.ring, `focus ring on "${f.name}" in ${title}`).toBe(true);
      expect(f.name, `labeled control in ${title}`).not.toBe('');
      visited.push(f.name);
    }
    console.log(`[${info.project.name}] ${title} tab stops: ${visited.join(' > ')}`);
    expect(visited).toContain('Close');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(menu.getByRole('button', { name: button })).toBeFocused();
  }
});

test('settings: labeled controls work by keyboard, apply at once and survive a reload', async ({ page }, info) => {
  await ready(page, './');
  await page.getByRole('button', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  const master = dialog.getByRole('slider', { name: 'Master volume' });
  await expect(master).toHaveValue('70'); // audio.json default
  await expect(dialog.getByRole('slider', { name: 'Music volume' })).toHaveValue('30');
  await expect(dialog.getByRole('slider', { name: 'Effects volume' })).toHaveValue('70');
  await expect(dialog.getByRole('radio', { name: 'Match my device (light or dark)' })).toBeChecked();
  await expect(dialog.getByRole('radio', { name: 'Follow my device setting' })).toBeChecked();

  await master.focus();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect(master).toHaveValue('60');
  await expect(dialog.locator('output[for="set-master"]')).toHaveText('60%');
  await dialog.getByRole('radio', { name: 'Dark', exact: true }).focus();
  await page.keyboard.press('ArrowDown'); // radio group: moves to High contrast
  await expect(dialog.getByRole('radio', { name: 'High contrast' })).toBeChecked();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'high_contrast');
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor)).toBe('rgb(255, 255, 255)');
  await dialog.getByRole('radio', { name: 'Reduce motion' }).check();
  await page.screenshot({ path: `docs/evidence/t19/settings-high-contrast-${info.project.name}.png` });
  await page.keyboard.press('Escape');
  await expect(page.locator('#save-status')).toHaveText('Saved');

  await ready(page, './');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'high_contrast');
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(master).toHaveValue('60');
  await expect(dialog.getByRole('radio', { name: 'High contrast' })).toBeChecked();
  await expect(dialog.getByRole('radio', { name: 'Reduce motion' })).toBeChecked();
});

test('the motion setting overrides the device preference both ways', async ({ browser, baseURL }) => {
  const first = startSession(rules, 'm', createGenerator(1));
  const slot = first.tray.findIndex((s) => s);
  const shape = shapeById(first.tray[slot]!.shapeId);
  // A tap puts the shape's bounding-box origin on the tapped cell; sample next to one of its real tiles.
  const anchor = [2, 2] as const;
  const [cx, cy] = [anchor[0] + shape.cells[0]![0], anchor[1] + shape.cells[0]![1]];
  for (const [device, choice, scaled] of [['reduce', 'Full motion', true], ['no-preference', 'Reduce motion', false]] as const) {
    const context = await browser.newContext({ viewport: { width: 800, height: 1000 }, baseURL: baseURL!, reducedMotion: device });
    const page = await context.newPage();
    await page.route('**/theme.json', async (route) => {
      const json = await (await route.fetch()).json();
      await route.fulfill({ json: { ...json, feedback_ms: { ...json.feedback_ms, place: 2000 } } });
    });
    const box = await ready(page, './?seed=1');
    await page.keyboard.press('Escape');
    await page.getByRole('dialog', { name: 'Paused' }).getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('radio', { name: choice }).check();
    await page.keyboard.press('Escape'); // closes Settings
    await page.getByRole('button', { name: 'Resume' }).click();
    await page.getByRole('button', { name: new RegExp(`^Slot ${slot + 1}`) }).click();
    const [ax, ay] = cellOrigin(BOARD, anchor);
    await page.mouse.click(...logicalToClient([ax + BOARD.pitch / 2, ay + BOARD.pitch / 2], box, VIEWPORT));
    const [left, top] = cellOrigin(BOARD, [cx, cy]);
    await expect(page.locator('#game')).toHaveAttribute('data-state', 'resolving');
    await canvasBox(page);
    // Just inside the gap left of the placed tile: covered only while the tile is scaled.
    const [gap] = await sample(page, [logicalToClient([left + 0.04 * BOARD.pitch, top + BOARD.pitch / 2], box, VIEWPORT)]);
    expect(colorDistance(gap!, theme.background) > 6, `device ${device}, setting "${choice}": gap rgb(${gap})`).toBe(scaled);
    await context.close();
  }
});

test('a hung content request ends in an error with Retry instead of endless loading', async ({ page }, info) => {
  await page.clock.install();
  await page.route('**/content/index.json', () => {}); // never answered
  await page.goto('./');
  await expect(page.getByRole('status')).toHaveText('Loading…');
  await page.clock.runFor(16_000);
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('Loading took too long');
  await expect(page.getByRole('button', { name: 'Retry' })).toBeFocused();
  await page.screenshot({ path: `docs/evidence/t19/load-timeout-${info.project.name}.png` });
  await page.unroute('**/content/index.json');
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByRole('status')).toHaveText(/Renderer ready/);
  await expect(alert).toBeHidden();
});

test('a damaged save is explained in plain words, with the technical reason folded away', async ({ page }) => {
  await ready(page, './?seed=1');
  await expect(page.locator('#save-status')).toHaveText('Saved');
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const r = indexedDB.open('line-garden');
        r.onsuccess = () => {
          const tx = r.result.transaction('saves', 'readwrite');
          tx.objectStore('saves').put({ schemaVersion: 1, storageRevision: 1 }, 'current');
          tx.oncomplete = () => (r.result.close(), resolve());
        };
      }),
  );
  await page.goto('./');
  const alert = page.getByRole('alert');
  await expect(alert.locator('#save-notice-text')).toHaveText('Your saved game could not be read. It is kept in this browser, not deleted.');
  await expect(alert.getByText('Technical details')).toBeVisible();
  await expect(alert.locator('#save-notice-detail-text')).toBeHidden();
  await alert.getByText('Technical details').click();
  await expect(alert.locator('#save-notice-detail-text')).toContainText('contentVersion is required');
  await expect(alert).toContainText('Saves stay in this browser on this device');
});
