import { webRoot } from './paths';
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '../e2e', testMatch: /damage-modifier-runtime\.spec\.ts/,
  outputDir: '../../output/playwright-damage-modifier', timeout: 60_000, workers: 1, retries: 0,
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4191', screenshot: 'only-on-failure' },
  webServer: { cwd: webRoot, command: 'npm run dev -- --host 127.0.0.1 --port 4191 --strictPort',
    url: 'http://127.0.0.1:4191', reuseExistingServer: false, timeout: 120_000 }
});
