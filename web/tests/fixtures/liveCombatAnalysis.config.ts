import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';
import base from './simulationAutomaticSkills.config';

export default defineConfig({ ...base,
  testDir: fileURLToPath(new URL('../e2e/', import.meta.url)),
  testMatch: /simulation-combat-analysis-live\.spec\.ts/,
  outputDir: fileURLToPath(new URL('../../output/combat-analysis/live-playwright/', import.meta.url)),
  use: { ...base.use, viewport: { width: 1440, height: 1080 } },
  timeout: 120_000,
  webServer: undefined
});
