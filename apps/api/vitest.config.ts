import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      exclude: ['src/**/*.test.ts'],
      provider: 'v8',
      reporter: ['text', 'html'],
    },
    environment: 'node',
    exclude: ['src/**/*.integration.test.ts'],
    include: ['src/**/*.test.ts'],
  },
});
