import { createServer } from 'vite';
import { chromium } from 'playwright';
const server = await createServer({ root: '.', logLevel: 'silent', server: { port: 5199 } });
await server.listen();
for (const [label, opts, dpr] of [['headless', {}, 1], ['headless', {}, 2], ['headed', { headless: false }, 1]]) {
  const b = await chromium.launch(opts);
  const p = await (await b.newContext({ deviceScaleFactor: dpr })).newPage();
  await p.goto('http://localhost:5199/');
  const r = await p.waitForFunction(() => window.__result, null, { timeout: 30000 }).then(h => h.jsonValue());
  console.log(label, `dpr=${dpr}`, b.version(), JSON.stringify(r));
  await b.close();
}
await server.close();
