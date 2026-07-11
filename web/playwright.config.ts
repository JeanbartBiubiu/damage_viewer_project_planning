import { defineConfig, devices } from '@playwright/test';

const apiBaseUrl = process.env.E2E_API_BASE_URL ?? 'http://localhost:8080';
const webBaseUrl = process.env.E2E_WEB_BASE_URL ?? 'http://localhost:5173';

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './output/playwright',
  timeout: 60_000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  use: {
    baseURL: webBaseUrl,
    trace: 'on-first-retry',
    extraHTTPHeaders: {
      Accept: 'application/json'
    }
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ],
  metadata: {
    apiBaseUrl
  }
});
