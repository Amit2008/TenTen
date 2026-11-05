import { defineConfig } from '@playwright/test';

// T26 measurements: the installed stable Chrome and Edge, headed (real vsync), one at a time, on the root build.
// Run: npx playwright test --config tools/profiling/playwright.config.ts
export default defineConfig({
  testDir: '.',
  testMatch: 'perf.spec.ts',
  workers: 1,
  timeout: 15 * 60_000,
  reporter: 'list',
  webServer: {
    command: 'npx vite build --base / --outDir dist && npx vite preview --base / --outDir dist --port 4175 --strictPort',
    url: 'http://localhost:4175/',
    reuseExistingServer: false,
    cwd: '../..',
  },
  use: { baseURL: 'http://localhost:4175/', headless: false, viewport: { width: 800, height: 1000 } },
  projects: [
    { name: 'chrome', use: { channel: 'chrome' } },
    { name: 'msedge', use: { channel: 'msedge' } },
  ],
});
