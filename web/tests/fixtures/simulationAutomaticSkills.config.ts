import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';
import base from '../../playwright.simulation-triggered-skills.config';
export default defineConfig({ ...base, testDir: fileURLToPath(new URL('../e2e/', import.meta.url)),
  testMatch: /simulation-automatic-(?:skills|cooldown)\.spec\.ts/, outputDir: fileURLToPath(new URL('../../output/automatic-skills/playwright/', import.meta.url)),
  use: { ...base.use, baseURL: process.env.SIMULATION_WEB_BASE || 'http://127.0.0.1:5173' }, webServer: undefined });
