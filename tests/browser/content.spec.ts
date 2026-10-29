import { expect, test } from '@playwright/test';

test('loads the pinned content version at startup', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('status')).toHaveText(/Content 1\.1\.0 loaded/);
});

test('a content failure shows an HTML error, not a spinner, and Retry recovers', async ({ page }, info) => {
  await page.route('**/content/index.json', (route) => route.fulfill({ status: 404, body: 'not found' }));
  await page.goto('./');
  const alert = page.getByRole('alert');
  await expect(alert).toBeVisible();
  await expect(page.locator('#error-message')).toHaveText(
    'The game content could not be loaded. content/index.json could not be downloaded (HTTP 404)',
  );
  await expect(page.locator('#webgl-help')).toBeHidden();
  await expect(page.getByRole('status')).toHaveText('');
  await page.screenshot({ path: `docs/evidence/t04/content-error-${info.project.name}.png` });

  await page.unroute('**/content/index.json');
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByRole('status')).toHaveText(/Content 1\.1\.0 loaded/);
  await expect(alert).toBeHidden();
});

test('malformed hosted rules are rejected before play', async ({ page }) => {
  await page.route('**/releases/1.1.0/rules.json', async (route) => {
    const rules = await (await route.fetch()).json();
    await route.fulfill({ json: { ...rules, tray_size: 9 } });
  });
  await page.goto('./');
  await expect(page.locator('#error-message')).toContainText('rules.json: tray_size must be between 1 and 5');
  await expect(page.locator('canvas')).toHaveCount(0);
});
