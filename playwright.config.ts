import { defineConfig, devices } from '@playwright/test';

// The same build is verified at the origin root and at the nested GitHub Pages base (ADR-001).
const root = { port: 4173, base: '/', outDir: 'dist' };
const nested = { port: 4174, base: '/TenTen/', outDir: 'dist-nested' };
const serve = ({ port, base, outDir }: typeof root) => ({
  command: `npx vite build --base ${base} --outDir ${outDir} && npx vite preview --base ${base} --outDir ${outDir} --port ${port} --strictPort`,
  url: `http://localhost:${port}${base}`,
  reuseExistingServer: !process.env.CI,
});

export default defineConfig({
  testDir: 'tests/browser',
  forbidOnly: !!process.env.CI,
  webServer: [serve(root), serve(nested)],
  projects: [
    { name: 'root', use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${root.port}/` } },
    { name: 'nested', use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${nested.port}${nested.base}` } },
    // Engine-independent rule checks (GDD 10): Playwright's Firefox and WebKit builds, not real Safari or devices.
    { name: 'firefox', testMatch: /(replay|sounds).spec.ts$/, use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', testMatch: /(replay|sounds).spec.ts$/, use: { ...devices['Desktop Safari'] } },
  ],
});
