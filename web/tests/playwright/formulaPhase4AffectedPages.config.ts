import { webRoot } from './paths';
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '../e2e', testMatch: /(?:simulation-phase4-real-pages|simulation-active-skills|simulation-complex-skills)\.spec\.ts/,
  outputDir: '../../output/playwright-formula-phase4-affected-pages', timeout: 150_000, workers: 1, retries: 0,
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4217', actionTimeout: 15_000, screenshot: 'only-on-failure', trace: 'off' },
  webServer: { cwd: webRoot, command: 'npm run dev -- --host 127.0.0.1 --port 4217 --strictPort',
    url: 'http://127.0.0.1:4217', reuseExistingServer: false, timeout: 60_000 }
});
