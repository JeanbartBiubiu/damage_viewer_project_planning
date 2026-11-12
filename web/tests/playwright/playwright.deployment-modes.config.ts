import { defineConfig, devices } from '@playwright/test';
import { webRoot } from './paths';

export default defineConfig({
  testDir: '../e2e', testMatch: 'deployment-modes.spec.ts', outputDir: '../../output/playwright-deployment-modes',
  timeout: 45_000, expect: { timeout: 10_000 }, workers: 1, retries: 0,
  use: { ...devices['Desktop Chrome'], screenshot: 'only-on-failure', trace: 'off', video: 'off' },
  projects: [
    { name: 'viewer', use: { baseURL: 'http://127.0.0.1:4197' } },
    { name: 'maintenance', use: { baseURL: 'http://127.0.0.1:4198' } }
  ],
  webServer: [
    { cwd: webRoot, env: { DEV_HTTPS_KEY_PATH: '', DEV_HTTPS_CERT_PATH: '' }, command: 'npm run preview -- --host 127.0.0.1 --port 4197 --strictPort', url: 'http://127.0.0.1:4197', reuseExistingServer: false },
    { cwd: webRoot, env: { DEV_HTTPS_KEY_PATH: '', DEV_HTTPS_CERT_PATH: '' }, command: 'npm run preview -- --mode maintenance --outDir dist-maintenance --host 127.0.0.1 --port 4198 --strictPort', url: 'http://127.0.0.1:4198', reuseExistingServer: false }
  ]
});
