import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /representative-image-table\.live\.spec\.ts/,
  outputDir: './output/playwright-image-table-live',
  timeout: 180_000,
  expect: { timeout: 15_000 },
  retries: 0,
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    ...devices['Desktop Chrome'],
    viewport: { width: 1280, height: 1000 },
    actionTimeout: 15_000,
    trace: 'off',
    screenshot: 'only-on-failure',
    video: 'off'
  }
});
