import { defineConfig, devices } from '@playwright/test';

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `${name} is required for wasm-generic e2e (fail-closed). Set a non-empty value; tests never skip when it is missing.`
    );
  }
  return value;
}

const apiBaseUrl = requireEnv('E2E_API_BASE_URL');
const gameId = requireEnv('E2E_GAME_ID');
const explicitWebBaseUrl = process.env.E2E_WEB_BASE_URL?.trim();
/** Deterministic loopback preview when E2E_WEB_BASE_URL is unset (uses just-built dist). */
const PREVIEW_PORT = 4173;
const webBaseUrl = explicitWebBaseUrl || `http://127.0.0.1:${PREVIEW_PORT}`;

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
    apiBaseUrl,
    gameId,
    webBaseUrl
  },
  ...(explicitWebBaseUrl
    ? {}
    : {
        webServer: {
          command: `npm run preview -- --host 127.0.0.1 --port ${PREVIEW_PORT} --strictPort`,
          url: webBaseUrl,
          reuseExistingServer: false,
          timeout: 120_000
        }
      })
});
