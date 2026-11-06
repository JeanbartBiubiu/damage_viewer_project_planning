import { webRoot } from './paths';
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '../e2e', testMatch: /simulation-compile\.spec\.ts/,
  outputDir: '../../output/playwright-simulation-compile', workers: 1, retries: 0, timeout: 60_000,
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4197', screenshot: 'only-on-failure' },
  webServer: { cwd: webRoot,
    command: 'npm run dev -- --host 127.0.0.1 --port 4197 --strictPort',
    url: 'http://127.0.0.1:4197', reuseExistingServer: false, timeout: 60_000
  }
});
