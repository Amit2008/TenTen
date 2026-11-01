import { expect, test } from '@playwright/test';

// Real browser with WebGL disabled: the DOM error screen must work without any canvas or GPU.
test.use({ launchOptions: { args: ['--disable-webgl', '--disable-webgl2', '--disable-3d-apis'] } });

test('shows the HTML error and a working Retry when WebGL2 is unavailable', async ({ page }, info) => {
  await page.goto('./');
  const alert = page.getByRole('alert');
  await expect(alert).toBeVisible();
  await expect(alert).toContainText("Line Garden can't start");
  await expect(page.locator('#error-message')).toHaveText('WebGL could not be started in this browser.');
  await expect(page.locator('canvas')).toHaveCount(0);
  const retry = page.getByRole('button', { name: 'Retry' });
  await expect(retry).toBeFocused();
  await page.screenshot({ path: `docs/evidence/t03/unsupported-${info.project.name}.png` });
  await retry.click();
  await expect(alert).toBeVisible();
  await expect(page.locator('canvas')).toHaveCount(0);
});

test('without WebGL the HTML still offers How to play and Credits', async ({ page }, info) => {
  await page.goto('./');
  const alert = page.getByRole('alert');
  await expect(alert).toBeVisible();
  for (const name of ['How to play', 'Credits']) {
    const button = alert.getByRole('button', { name });
    await button.click();
    const dialog = page.getByRole('dialog', { name });
    await expect(dialog).toBeVisible();
    if (name === 'How to play') await page.screenshot({ path: `docs/evidence/t19/unsupported-help-${info.project.name}.png` });
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(button).toBeFocused();
  }
});
