import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    coverage: { provider: 'v8', reporter: ['text', 'html'] },
    environment: 'jsdom',
    exclude: ['src/**/*.browser.test.{ts,tsx}'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
