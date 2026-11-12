import { webRoot } from './paths';
import { defineConfig, devices } from '@playwright/test';

const baseURL = 'http://127.0.0.1:4186';
export default defineConfig({
  testDir: '../e2e', testMatch: 'visit-statistics.spec.ts', outputDir: '../../output/playwright-visits',
  timeout: 45_000, expect: { timeout: 10_000 }, workers: 1, retries: 0, fullyParallel: false,
  use: { baseURL, screenshot: 'only-on-failure', trace: 'off', video: 'off' },
  projects: [{ name: 'Desktop Chrome', use: { ...devices['Desktop Chrome'] } }],
  webServer: { cwd: webRoot,
    env: { DEV_HTTPS_KEY_PATH: '', DEV_HTTPS_CERT_PATH: '' },
    command: 'npm run preview -- --host 127.0.0.1 --port 4186 --strictPort', url: baseURL,
    reuseExistingServer: false, timeout: 120_000
  }
});
