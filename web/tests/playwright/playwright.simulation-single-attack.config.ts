import { webRoot } from './paths';
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '../e2e', testMatch: /simulation-single-attack\.spec\.ts/,
  outputDir: '../../output/playwright-simulation-single-attack', workers: 1, retries: 0, timeout: 60_000,
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4198', screenshot: 'only-on-failure', trace: 'off' },
  webServer: { cwd: webRoot,
    command: 'npm run dev -- --host 127.0.0.1 --port 4198 --strictPort',
    url: 'http://127.0.0.1:4198', reuseExistingServer: false, timeout: 60_000
  }
});
