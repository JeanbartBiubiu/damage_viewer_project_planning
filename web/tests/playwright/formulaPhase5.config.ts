import { webRoot } from './paths';
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '../e2e', testMatch: /formula-phase5-events\.spec\.ts/,
  outputDir: '../../output/playwright-formula-phase5', timeout: 150_000, workers: 1, retries: 0,
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4221', actionTimeout: 15_000, screenshot: 'only-on-failure', trace: 'off' },
  webServer: { cwd: webRoot, command: 'npm run dev -- --host 127.0.0.1 --port 4221 --strictPort', url: 'http://127.0.0.1:4221', reuseExistingServer: false, timeout: 60_000 }
});
