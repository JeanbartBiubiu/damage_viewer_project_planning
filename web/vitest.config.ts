import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: { __DAMAGE_DEPLOYMENT_MODE__: JSON.stringify('maintenance') },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/mechanisms/**/*.test.ts'],
    exclude: ['node_modules', 'dist', 'tests/e2e/**']
  }
});
