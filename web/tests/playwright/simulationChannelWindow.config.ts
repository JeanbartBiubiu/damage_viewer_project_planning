import { webRoot } from './paths';
import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import base from './playwright.simulation-triggered-skills.config';

export default defineConfig({ ...base, testDir: fileURLToPath(new URL('../e2e/', import.meta.url)),
  testMatch: /simulation-(complex-skills|channel-window)\.spec\.ts/,
  outputDir: fileURLToPath(new URL('../../output/phase6c/channel-window/playwright/', import.meta.url)),
  use: { ...base.use, baseURL: 'http://127.0.0.1:4199' },
  webServer: { command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4199 --strictPort',
    cwd: webRoot,
    url: 'http://127.0.0.1:4199', reuseExistingServer: false, timeout: 60_000 }
});
