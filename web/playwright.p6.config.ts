import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e', testMatch: /p6-runtime\.spec\.ts/,
  outputDir: './output/playwright-p6', timeout: 60_000, workers: 1, retries: 0,
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4180', screenshot: 'only-on-failure' },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4180 --strictPort',
    url: 'http://127.0.0.1:4180', reuseExistingServer: false, timeout: 120_000
  }
});
