import { defineConfig } from '@playwright/test';
import base from './playwright.simulation-triggered-skills.config';

export default defineConfig({ ...base, testMatch: /simulation-source-admission\.spec\.ts/,
  outputDir: '../../output/playwright-simulation-source-admission' });
