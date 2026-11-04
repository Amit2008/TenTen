import { expect, test } from '@playwright/test';

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
