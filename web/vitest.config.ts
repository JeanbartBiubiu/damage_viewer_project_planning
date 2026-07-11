import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'src/**/*.test.ts',
      'src/**/wasm-catalog*.test.ts',
      'src/**/generic*.test.ts'
    ],
    exclude: ['node_modules', 'dist', 'tests/e2e/**']
  }
});
