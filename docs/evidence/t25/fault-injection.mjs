// One-off T25 fault injection against the production build (vite preview :4180). Not part of the suite.
import { chromium } from 'file:///C:/Amit/TenTen/node_modules/playwright/index.mjs';

const BASE = 'http://localhost:4180/';
const R = '**/content/releases/1.1.0/';
const browser = await chromium.launch();
const rows = [];

async function snapshot(page) {
  return page.evaluate(() => ({
    status: document.getElementById('status').textContent,
    error: document.getElementById('error').hidden ? null : document.getElementById('error-message').textContent,
    saveStatus: document.getElementById('save-status').textContent,
    notice: document.getElementById('save-notice').hidden ? null : document.getElementById('save-notice-text').textContent,
    state: document.getElementById('game').dataset.state ?? null,
    canvasInert: document.querySelector('#game canvas')?.inert ?? null,
    continueShown: !document.getElementById('menu-continue').hidden,
  }));
}
const settled = (page) =>
  page.waitForFunction(() => !document.getElementById('error').hidden || /Renderer ready/.test(document.getElementById('status').textContent), null, { timeout: 20000 });

async function contentFault(name, glob, handler) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}?seed=7`); // creates a saved run first
  await settled(page);
  await page.waitForFunction(() => document.getElementById('save-status').textContent === 'Saved');
  await page.route(glob, handler);
  await page.goto(BASE);
  await settled(page);
  const failed = await snapshot(page);
  await page.unroute(glob);
  if (failed.error === null) { rows.push({ name, failed, note: 'fault did not surface' }); await ctx.close(); return; }
  await page.click('#retry');
  await settled(page);
  await page.waitForFunction(() => !document.getElementById('menu').hidden, null, { timeout: 10000 }).catch(() => {});
  rows.push({ name, failed, afterRetry: await snapshot(page), errors });
  await ctx.close();
}

async function playableFault(name, init, after) {
  const ctx = await browser.newContext();
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}?seed=7`);
  await settled(page);
  await page.waitForTimeout(500);
  if (after) await after(page);
  rows.push({ name, result: await snapshot(page), errors });
  await ctx.close();
}

await contentFault('missing file (theme.json 404)', `${R}theme.json`, (r) => r.fulfill({ status: 404, body: 'not found' }));
await contentFault('failed fetch (rules.json aborted)', `${R}rules.json`, (r) => r.abort('connectionreset'));
await contentFault('malformed JSON (pieces.json truncated)', `${R}pieces.json`, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"schema_version": 1, "shapes": [' }));
await contentFault('wrong MIME, HTML body (SPA fallback for rules.json)', `${R}rules.json`, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><p>app</p>' }));
await contentFault('wrong MIME, valid JSON body (index.json as text/html)', '**/content/index.json', async (r) => {
  const res = await r.fetch();
  await r.fulfill({ response: res, contentType: 'text/html' });
});
await playableFault('audio rejection (AudioContext constructor throws)', () => {
  window.AudioContext = class { constructor() { throw new DOMException('denied', 'NotAllowedError'); } };
}, (page) => page.click('#pause-button').then(() => page.click('#resume')));
await playableFault('storage denial (indexedDB.open throws SecurityError)', () => {
  IDBFactory.prototype.open = function () { throw new DOMException('The operation is insecure.', 'SecurityError'); };
});
await playableFault('newer schema opened in another tab (real versionchange)', null, async (page) => {
  await page.waitForFunction(() => document.getElementById('save-status').textContent === 'Saved');
  await page.evaluate(() => new Promise((res) => {
    const r = indexedDB.open('line-garden', 2);
    r.onsuccess = () => { r.result.close(); res('opened'); };
    r.onblocked = () => res('blocked');
    r.onerror = () => res('error');
  }));
  await page.waitForTimeout(300);
});
await playableFault('blocked upgrade (SYNTHETIC: onblocked fired by a wrapper; unreachable at schema v1)', () => {
  const open = IDBFactory.prototype.open;
  IDBFactory.prototype.open = function (...args) {
    const req = open.apply(this, args);
    queueMicrotask(() => req.onblocked?.(new Event('blocked')));
    return req;
  };
}, (page) => page.waitForTimeout(300));

await browser.close();
console.log(JSON.stringify(rows, null, 2));
