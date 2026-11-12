import { defineConfig, devices } from '@playwright/test';
import { webRoot } from './paths';

const baseURL = 'http://127.0.0.1:4243';
export default defineConfig({
  testDir: '../e2e', testMatch: 'simulation-selection.spec.ts', outputDir: '../../output/playwright-viewer-selection',
  timeout: 60_000, expect: { timeout: 10_000 }, workers: 1, retries: 0,
  use: { ...devices['Desktop Chrome'], baseURL, screenshot: 'only-on-failure', trace: 'off' },
  webServer: { cwd: webRoot, env: { DEV_HTTPS_KEY_PATH: '', DEV_HTTPS_CERT_PATH: '' },
    command: 'npm run dev -- --host 127.0.0.1 --port 4243 --strictPort', url: baseURL, reuseExistingServer: false, timeout: 60_000 }
});
