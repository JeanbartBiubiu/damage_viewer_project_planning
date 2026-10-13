import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  testDir: fileURLToPath(new URL('../e2e/', import.meta.url)), testMatch: /channel-window-authoring\.spec\.ts/,
  outputDir: fileURLToPath(new URL('../../output/phase6c/channel-window-authoring/', import.meta.url)),
  timeout: 60_000, workers: 1, retries: 0,
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4198', screenshot: 'only-on-failure' },
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 4198 --strictPort',
    url: 'http://127.0.0.1:4198', reuseExistingServer: false, timeout: 120_000 }
});
