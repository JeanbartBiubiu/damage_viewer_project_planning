import { defineConfig, devices } from '@playwright/test';

// 显式手动执行的本地真实上传验收，不进入常规接口替身回归。
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /representative-image-upload\.live\.spec\.ts/,
  outputDir: './output/playwright-image-upload-live',
  timeout: 180_000,
  expect: { timeout: 15_000 },
  retries: 0,
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    ...devices['Desktop Chrome'],
    viewport: { width: 1600, height: 1200 },
    actionTimeout: 15_000,
    trace: 'off',
    screenshot: 'only-on-failure',
    video: 'off'
  }
});
