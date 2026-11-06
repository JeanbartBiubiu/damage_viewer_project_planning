import { webRoot } from './paths';
import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.AUTH_WEB_BASE_URL?.trim() || 'http://127.0.0.1:4185';
export default defineConfig({
  testDir: '../e2e', testMatch: 'account-auth.spec.ts', outputDir: '../../output/playwright-auth',
  timeout: 45_000, expect: { timeout: 10_000 }, workers: 1, retries: 0, fullyParallel: false,
  use: { baseURL, screenshot: 'only-on-failure', trace: 'off', video: 'off' },
  projects: [{ name: 'Desktop Chrome', use: { ...devices['Desktop Chrome'] } }],
  ...(!process.env.AUTH_WEB_BASE_URL?.trim() ? { webServer: { cwd: webRoot,
    command: 'npm run preview -- --host 127.0.0.1 --port 4185 --strictPort', url: baseURL,
    reuseExistingServer: false, timeout: 120_000
  } } : {})
});
