import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '../e2e', testMatch: /formula-phase3\.spec\.ts/,
  outputDir: '../../output/playwright-formula-phase3', timeout: 120_000, workers: 1, retries: 0,
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4195', screenshot: 'only-on-failure', trace: 'off' },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4195 --strictPort',
    url: 'http://127.0.0.1:4195', reuseExistingServer: false, timeout: 60_000
  }
});
