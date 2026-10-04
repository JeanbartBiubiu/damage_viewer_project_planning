import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e', testMatch: /simulation-natural-skills\.spec\.ts/,
  outputDir: './output/playwright-simulation-natural-skills', workers: 1, retries: 0, timeout: 90_000,
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4202', screenshot: 'only-on-failure', trace: 'off' },
  webServer: {
    command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4202 --strictPort',
    url: 'http://127.0.0.1:4202', reuseExistingServer: false, timeout: 60_000
  }
});
