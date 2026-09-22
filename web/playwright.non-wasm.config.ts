import { defineConfig, devices } from '@playwright/test';

/**
 * Isolated non-Wasm Playwright acceptance config.
 * Requires zero E2E_* environment variables.
 *
 * Optional purpose-built base URL (not E2E_*): NON_WASM_WEB_BASE_URL.
 * When unset, starts an isolated loopback Vite preview on a fixed non-conflicting port.
 */
const NON_WASM_PREVIEW_PORT = 4174;
const optionalWebBaseUrl = process.env.NON_WASM_WEB_BASE_URL?.trim();
const webBaseUrl = optionalWebBaseUrl || `http://127.0.0.1:${NON_WASM_PREVIEW_PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /(?:non-wasm-pages|relation-management|character-authoring-check|authoring-p9)\.spec\.ts/,
  outputDir: './output/playwright-non-wasm',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  use: {
    baseURL: webBaseUrl,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off'
  },
  projects: [
    {
      name: 'Desktop Chrome',
      use: { ...devices['Desktop Chrome'] }
    }
  ],
  ...(optionalWebBaseUrl
    ? {}
    : {
        webServer: {
          command: `npm run preview -- --host 127.0.0.1 --port ${NON_WASM_PREVIEW_PORT} --strictPort`,
          url: webBaseUrl,
          reuseExistingServer: false,
          timeout: 120_000
        }
      })
});
