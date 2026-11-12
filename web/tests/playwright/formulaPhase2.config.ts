import { webRoot } from './paths';
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '../e2e', testMatch: /formula-phase2\.spec\.ts/,
  outputDir: '../../output/playwright-formula-phase2', timeout: 90_000, workers: 1, retries: 0,
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4194', screenshot: 'only-on-failure', trace: 'off' },
  webServer: { cwd: webRoot,
    command: 'npm run dev -- --host 127.0.0.1 --port 4194 --strictPort',
    url: 'http://127.0.0.1:4194', reuseExistingServer: false, timeout: 60_000
  }
});
