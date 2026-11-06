import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '../e2e', testMatch: /calculation-rules\.spec\.ts/,
  outputDir: '../../output/calculation-rules/playwright', workers: 1, retries: 0, timeout: 150_000,
  use: { ...devices['Desktop Chrome'], baseURL: process.env.SIMULATION_WEB_BASE || 'http://127.0.0.1:5173',
    actionTimeout: 15_000, screenshot: 'only-on-failure', trace: 'off' }
});
