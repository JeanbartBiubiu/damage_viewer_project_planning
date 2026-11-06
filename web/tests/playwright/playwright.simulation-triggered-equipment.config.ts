import { webRoot } from './paths';
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '../e2e', testMatch: /simulation-(?:(?:triggered|cadence|configured)-equipment|onhit-combinations)\.spec\.ts/,
  outputDir: '../../output/playwright-simulation-triggered-equipment', workers: 1, retries: 0, timeout: 60_000,
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4201', screenshot: 'only-on-failure', trace: 'off' },
  webServer: { cwd: webRoot,
    command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4201 --strictPort',
    url: 'http://127.0.0.1:4201', reuseExistingServer: false, timeout: 60_000
  }
});
