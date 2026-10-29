import { expect, test, type Page } from '@playwright/test';

async function canvasInfo(page: Page) {
  return page.locator('#game canvas').evaluate((canvas: HTMLCanvasElement) => {
    // Asking for the context type the canvas already owns returns that same context.
    const gl = canvas.getContext('webgl2');
    const dbg = gl?.getExtension('WEBGL_debug_renderer_info');
    return {
      isWebGL2: gl instanceof WebGL2RenderingContext,
      gpu: gl && dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : 'n/a',
      css: [canvas.clientWidth, canvas.clientHeight],
      backing: [canvas.width, canvas.height],
      dpr: devicePixelRatio,
    };
  });
}

test('starts an actual WebGL2 renderer and loads base-relative assets', async ({ page, baseURL }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const icon = page.waitForResponse((r) => r.url().endsWith('/icon.svg') && r.request().resourceType() !== 'other');
  await page.goto('./');
  await expect(page.getByRole('status')).toHaveText(/Renderer ready \(WebGL2\)/);
  const iconResponse = await icon;
  expect(iconResponse.url()).toBe(`${baseURL}icon.svg`);
  expect(iconResponse.status()).toBe(200);
  const result = await canvasInfo(page);
  expect(result.isWebGL2).toBe(true);
  console.log(`[${info.project.name}] ${baseURL} ${JSON.stringify(result)}`);
  await page.screenshot({ path: `docs/evidence/t03/shell-${info.project.name}.png` });
  expect(errors).toEqual([]);
});

for (const dpr of [1, 2, 3]) {
  test(`CSS size and framebuffer stay distinct at DPR ${dpr} (cap 2)`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({ deviceScaleFactor: dpr, viewport: { width: 800, height: 900 }, baseURL: baseURL! });
    const page = await context.newPage();
    await page.goto('./');
    await expect(page.getByRole('status')).toHaveText(/Renderer ready/);
    const { css, backing } = await canvasInfo(page);
    const resolution = Math.min(dpr, 2);
    expect(backing).toEqual([css[0]! * resolution, css[1]! * resolution]);
    expect(Math.abs(css[0]! / css[1]! - 720 / 960)).toBeLessThan(0.01); // square cells: aspect preserved
    await context.close();
  });
}

test('refits the canvas when the container resizes, letterboxed without cropping', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('./');
  await expect(page.getByRole('status')).toHaveText(/Renderer ready/);
  const wide = await canvasInfo(page);
  await page.setViewportSize({ width: 360, height: 640 });
  await expect.poll(async () => (await canvasInfo(page)).css[0]).toBeLessThanOrEqual(360);
  const narrow = await canvasInfo(page);
  expect(narrow.css[0]).toBeLessThan(wide.css[0]!);
  const box = (await page.locator('#game canvas').boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(640);
});
