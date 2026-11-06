import { webRoot } from './paths';
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '../e2e', testMatch: /simulation-equipment\.spec\.ts/,
  outputDir: '../../output/playwright-simulation-equipment', workers: 1, retries: 0, timeout: 60_000,
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4200', screenshot: 'only-on-failure', trace: 'off' },
  webServer: { cwd: webRoot,
    command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4200 --strictPort',
    url: 'http://127.0.0.1:4200', reuseExistingServer: false, timeout: 60_000
  }
});
