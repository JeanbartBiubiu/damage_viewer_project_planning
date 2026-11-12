import { webRoot } from './paths';
import { defineConfig, devices } from '@playwright/test';

const port = 4196;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: '../e2e',
  testMatch: /workspace-modes\.spec\.ts/,
  outputDir: '../../output/playwright-workspace-modes',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  use: {
    baseURL,
    trace: 'off',
    screenshot: 'only-on-failure',
    video: 'off'
  },
  projects: [{ name: 'Desktop Chrome', use: { ...devices['Desktop Chrome'] } }],
  webServer: { cwd: webRoot, env: { DEV_HTTPS_KEY_PATH: '', DEV_HTTPS_CERT_PATH: '' },
    command: `npm run preview -- --mode maintenance --outDir dist-maintenance --host 127.0.0.1 --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 60_000
  }
});
