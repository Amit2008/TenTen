import { expect, test } from '@playwright/test';

test('production build serves the HTML shell', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./');
  await expect(page).toHaveTitle('Line Garden');
  await expect(page.getByRole('status')).toHaveText(/Shell ready/);
  expect(errors).toEqual([]);
});
