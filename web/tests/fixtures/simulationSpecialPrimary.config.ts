import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';
import triggeredConfig from '../../playwright.simulation-triggered-skills.config';

export default defineConfig({
  ...triggeredConfig,
  testDir: fileURLToPath(new URL('../e2e/', import.meta.url)),
  testMatch: /simulation-special-primary\.spec\.ts/,
  outputDir: fileURLToPath(new URL('../../output/phase5c/playwright/', import.meta.url)),
  use: { ...triggeredConfig.use, baseURL: process.env.SIMULATION_WEB_BASE || 'http://127.0.0.1:5173' },
  webServer: undefined
});
