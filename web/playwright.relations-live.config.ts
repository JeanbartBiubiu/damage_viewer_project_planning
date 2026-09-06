import { defineConfig, devices } from '@playwright/test';

// 仅在已启动的本地前后端上手动执行；不进入常规接口替身回归。
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /relation-management\.live\.spec\.ts/,
  outputDir: process.env.STAGE9_LIVE_PHASE === 'image-usages'
    ? './output/playwright-relations-live-image-usages' : './output/playwright-relations-live',
  timeout: 240_000,
  expect: { timeout: 15_000 },
  retries: 0,
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    ...devices['Desktop Chrome'],
    viewport: { width: 1600, height: 1100 },
    trace: 'off',
    screenshot: 'only-on-failure',
    video: 'off',
    actionTimeout: 15_000
  }
});
