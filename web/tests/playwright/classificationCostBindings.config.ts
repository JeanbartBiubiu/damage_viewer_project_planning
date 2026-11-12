import { defineConfig, devices } from '@playwright/test';
import { webRoot } from './paths';

const configuredBase = process.env.SIMULATION_WEB_BASE?.trim();
const baseURL = configuredBase || 'http://127.0.0.1:4242';

export default defineConfig({
  testDir: '../e2e', testMatch: /classification-cost-bindings\.spec\.ts/,
  outputDir: '../../output/classification-cost-bindings/playwright', workers: 1, retries: 0, timeout: 150_000,
  use: { ...devices['Desktop Chrome'], baseURL, actionTimeout: 15_000, screenshot: 'only-on-failure', trace: 'off' },
  ...(!configuredBase ? { webServer: { cwd: webRoot, env: { DEV_HTTPS_KEY_PATH: '', DEV_HTTPS_CERT_PATH: '' },
    command: 'npm run dev:maintenance -- --host 127.0.0.1 --port 4242 --strictPort', url: baseURL, reuseExistingServer: false, timeout: 60_000
  } } : {})
});
