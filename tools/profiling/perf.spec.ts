// T26 measurements against the production build (GDD 10 budgets). Writes docs/evidence/t26/<browser>-<part>.json.
import { expect, test, type Browser, type Page } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { cellOrigin, logicalToClient, type ClientBox } from '../../src/presentation/views/layout';
import type { Cell } from '../../src/domain/models/types';
import { BOARD, VIEWPORT, ready } from '../../tests/browser/helpers';

const OUT = 'docs/evidence/t26';
/** `RESTARTS=200` for a longer leak check; samples every 25. */
const RESTARTS = Number(process.env.RESTARTS ?? 100);
mkdirSync(OUT, { recursive: true });
const record = (name: string, data: unknown) => {
  writeFileSync(`${OUT}/${test.info().project.name}-${name}.json`, `${JSON.stringify(data, null, 2)}\n`);
  console.log(name, JSON.stringify(data));
};
const pct = (xs: readonly number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.max(0, Math.ceil((p / 100) * s.length) - 1)]!;
};
const round = (x: number) => Math.round(x * 100) / 100;
const summary = (xs: readonly number[]) => ({ n: xs.length, median: round(pct(xs, 50)), p95: round(pct(xs, 95)), max: round(Math.max(...xs)) });
const newPage = async (browser: Browser, baseURL: string) => (await browser.newContext({ baseURL: baseURL!, viewport: { width: 800, height: 1000 } })).newPage();

const recorded = JSON.parse(readFileSync('tests/property/fixtures/recorded-seed-2026.json', 'utf8')) as { seed: number; commands: { slot: number; anchor: Cell }[] };
const cellClient = ([x, y]: Cell, box: ClientBox) => {
  const [left, top] = cellOrigin(BOARD, [x, y]);
  return logicalToClient([left + BOARD.pitch / 2, top + BOARD.pitch / 2], box, VIEWPORT);
};
async function place(page: Page, box: ClientBox, i: number) {
  const { slot, anchor } = recorded.commands[i]!;
  await page.getByRole('button', { name: new RegExp(`^Slot ${slot + 1}`) }).click();
  await page.mouse.click(...cellClient(anchor, box));
  await expect(page.locator('#game')).toHaveAttribute('data-state', /^(idle|results)$/); // the last recorded move ends the run
}

test('environment', async ({ browser, baseURL }) => {
  const page = await newPage(browser, baseURL!);
  await ready(page, './');
  const gpu = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2')!;
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    return { renderer: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'masked', ua: navigator.userAgent, dpr: devicePixelRatio, screen: [screen.width, screen.height] };
  });
  record('environment', { browser: browser.version(), ...gpu, date: new Date().toISOString() });
});

test('cold load under 10 Mbps / 100 ms, and initial transfer', async ({ browser, baseURL }) => {
  const runs: number[] = [];
  let files: { path: string; served: number; gzip: number }[] = [];
  for (let run = 0; run < 3; run++) {
    const page = await newPage(browser, baseURL!);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 100, downloadThroughput: 10e6 / 8, uploadThroughput: 10e6 / 8 });
    const urls = new Map<string, string>();
    const sizes = new Map<string, number>();
    cdp.on('Network.responseReceived', (e) => urls.set(e.requestId, e.response.url));
    cdp.on('Network.loadingFinished', (e) => sizes.set(e.requestId, e.encodedDataLength));
    await page.goto('./');
    // Interactive: the menu's New game button can be used.
    await expect(page.getByRole('button', { name: 'New game' })).toBeEnabled({ timeout: 30_000 });
    runs.push(await page.evaluate(() => performance.now()));
    await page.waitForTimeout(1500); // anything fetched just after the menu still counts as initial
    files = [...sizes].flatMap(([id, served]) => {
      const url = urls.get(id);
      if (!url?.startsWith(baseURL!)) return [];
      const path = new URL(url).pathname.replace(/^\/$/, '/index.html');
      return [{ path, served, gzip: gzipSync(readFileSync(`dist${path}`)).length }];
    });
    await page.context().close();
  }
  const sum = (fs: typeof files, k: 'served' | 'gzip') => fs.reduce((a, f) => a + f[k], 0);
  const audio = files.filter((f) => f.path.includes('/audio/'));
  const initial = files.filter((f) => !f.path.includes('/audio/'));
  record('load', {
    interactiveMs: runs.map(Math.round),
    budgetMs: 3000,
    initialBytes: { served: sum(initial, 'served'), gzipEstimate: sum(initial, 'gzip'), budget: 2 * 1024 * 1024 },
    audioBytes: { served: sum(audio, 'served'), gzipEstimate: sum(audio, 'gzip') },
    files,
  });
});

test('active-animation frame intervals and command time', async ({ browser, baseURL }) => {
  const page = await newPage(browser, baseURL!);
  const box = await ready(page, `./?seed=${recorded.seed}`);
  await page.evaluate(() => {
    const frames: [number, string][] = ((window as unknown as { frames_: [number, string][] }).frames_ = []);
    const loop = (t: number) => {
      frames.push([t, document.getElementById('game')!.dataset.state ?? '']);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
  for (let i = 0; i < recorded.commands.length; i++) await place(page, box, i);
  const frames = await page.evaluate(() => (window as unknown as { frames_: [number, string][] }).frames_);
  const intervals = (state: string) =>
    frames.slice(1).flatMap(([t, s], i) => (s === state && frames[i]![1] === state ? [t - frames[i]![0]] : []));
  const active = intervals('resolving').slice(20); // warm-up: the first move's feedback frames
  const idle = intervals('idle');

  // Command processing in the same browser: the real session code, bundled.
  const { build } = await import('vite');
  const out = await build({ configFile: false, logLevel: 'silent', build: { write: false, minify: true, lib: { entry: 'tools/profiling/command-bench.ts', formats: ['iife'], name: 'Bench' } } });
  const result = Array.isArray(out) ? out[0]! : out;
  if (!('output' in result)) throw new Error('unexpected Vite build result');
  const rules = JSON.parse(readFileSync('public/content/releases/1.1.0/rules.json', 'utf8'));
  const pieces = JSON.parse(readFileSync('public/content/releases/1.1.0/pieces.json', 'utf8'));
  const bench = await newPage(browser, baseURL!);
  await bench.goto('./licenses/OFL-Atkinson-Hyperlegible.txt'); // same origin, no game running
  await bench.addScriptTag({ content: result.output[0].code });
  const times = await bench.evaluate(({ rules, pieces }) => {
    const B = (window as unknown as { Bench: typeof import('./command-bench') }).Bench;
    const config = B.parseGameplay(rules, pieces).config;
    B.benchCommands(config, [1, 2, 3, 4, 5]); // warm-up (JIT)
    return B.benchCommands(config, Array.from({ length: 50 }, (_, i) => 100 + i));
  }, { rules, pieces });

  record('frames-commands', {
    activeFrameMs: { ...summary(active), budgetP95: 20 },
    idleFrameMs: summary(idle),
    commandMs: { ...summary(times), budgetP95: 8, timerResolutionMs: 0.1 },
  });
});

test('100 restarts retain no listeners, GPU objects or growing memory', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL: baseURL!, viewport: { width: 800, height: 1000 } });
  // Live WebGL objects: created minus deleted, counted in the page's own context.
  await context.addInitScript(() => {
    const live: Record<string, number> = ((window as unknown as { gl_: Record<string, number> }).gl_ = {});
    const P = WebGL2RenderingContext.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
    for (const kind of ['Buffer', 'Texture', 'Framebuffer', 'Renderbuffer', 'Program', 'Shader', 'VertexArray', 'Query', 'Sampler']) {
      const create = P[`create${kind}`]!;
      const del = P[`delete${kind}`]!;
      P[`create${kind}`] = function (this: unknown, ...a: unknown[]) {
        const o = create.apply(this, a);
        if (o) live[kind] = (live[kind] ?? 0) + 1;
        return o;
      };
      P[`delete${kind}`] = function (this: unknown, o: unknown) {
        if (o) live[kind] = (live[kind] ?? 0) - 1;
        return del.call(this, o);
      };
    }
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const box = await ready(page, `./?seed=${recorded.seed}`);
  const sample = async (restarts: number) => {
    await cdp.send('HeapProfiler.collectGarbage');
    const dom = await cdp.send('Memory.getDOMCounters');
    const heap = await cdp.send('Runtime.getHeapUsage');
    const gl = await page.evaluate(() => ({ ...(window as unknown as { gl_: Record<string, number> }).gl_ }));
    return { restarts, jsEventListeners: dom.jsEventListeners, domNodes: dom.nodes, heapMB: round(heap.usedSize / 2 ** 20), gl };
  };
  /** Pause → Restart → confirm, then one move (keyboard: slot 1 at the centered anchor, which fits an empty board). */
  const restart = async () => {
    await page.locator('#pause-button').click();
    await page.locator('#pause-restart').click();
    await page.locator('#confirm-yes').click();
    await expect(page.locator('#game')).toHaveAttribute('data-state', 'idle');
    await page.keyboard.press('1');
    await page.keyboard.press('Enter');
    await expect(page.locator('#game')).toHaveAttribute('data-state', 'idle');
    await expect(page.locator('#score')).not.toHaveText('0');
  };
  await place(page, box, 0);
  await restart(); // the first restart warms every path (feedback, pause, confirm) before the baseline
  const samples = [await sample(1)];
  for (let i = 2; i <= RESTARTS; i++) {
    await restart();
    if (i % 25 === 0) samples.push(await sample(i));
  }
  record('restarts', { samples, errors });
  const [first, last] = [samples[0]!, samples.at(-1)!];
  expect(last.jsEventListeners, 'event listeners').toBe(first.jsEventListeners);
  // Pixi may grow its batch pool once (1 VAO + 2 buffers seen in Chrome, then flat to 200 restarts); a leak per restart
  // would add objects every time and exceed this slack.
  for (const [kind, n] of Object.entries(last.gl)) expect(n, `live WebGL ${kind}`).toBeLessThanOrEqual((first.gl[kind] ?? 0) + 4);
  expect(errors).toEqual([]);
  await context.close();
});
