import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
import { webRoot } from './paths';

const output = fileURLToPath(new URL('../../../output/full-authoring-20261113/varus-delay-native/browser-recovery/', import.meta.url));
const baseURL = 'http://127.0.0.1:4209';

export default defineConfig({
  testDir: fileURLToPath(new URL('../e2e/', import.meta.url)),
  testMatch: /skill-hit-passive-delay\.spec\.ts/,
  outputDir: `${output}/test-results`,
  reporter: [['line'], ['json', { outputFile: `${output}/playwright-report.json` }]],
  workers: 1, retries: 0, timeout: 60_000,
  use: { ...devices['Desktop Chrome'], baseURL, trace: 'off', video: 'off', screenshot: 'only-on-failure' },
  webServer: {
    cwd: webRoot,
    env: { DEV_HTTPS_KEY_PATH: '', DEV_HTTPS_CERT_PATH: '' },
    command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4209 --strictPort',
    url: baseURL, reuseExistingServer: false, timeout: 60_000
  }
});
