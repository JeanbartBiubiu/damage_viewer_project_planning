import { webRoot } from './paths';
import { defineConfig, devices } from '@playwright/test';
export default defineConfig({ testDir: '../e2e', testMatch: 'phase3b-web-adapter-proof.spec.ts',
  outputDir: '../../output/playwright-phase3b-web-proof', timeout: 60000, workers: 1,
  use: { baseURL: 'http://127.0.0.1:4189', ...devices['Desktop Chrome'], screenshot: 'only-on-failure' },
  webServer: { cwd: webRoot, command: 'npm run dev -- --host 127.0.0.1 --port 4189 --strictPort', url: 'http://127.0.0.1:4189', reuseExistingServer: false } });
