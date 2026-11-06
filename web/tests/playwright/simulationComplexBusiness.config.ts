import { webRoot } from './paths';
import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import base from './playwright.simulation-triggered-skills.config';

export default defineConfig({ ...base, testDir: fileURLToPath(new URL('../e2e/', import.meta.url)),
  testMatch: /simulation-complex-business\.spec\.ts/,
  timeout: 240_000, expect: { timeout: 20_000 }, workers: 1, retries: 0,
  outputDir: fileURLToPath(new URL('../../output/phase6c/business/playwright/', import.meta.url)),
  use: { ...base.use, baseURL: 'http://127.0.0.1:4217', viewport: { width: 1440, height: 1100 } },
  webServer: { command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4217 --strictPort',
    cwd: webRoot, url: 'http://127.0.0.1:4217', reuseExistingServer: false, timeout: 60_000 }
});
