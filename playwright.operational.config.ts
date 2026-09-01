import { defineConfig } from '@playwright/test';

export default defineConfig({
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  testDir: './tests/operational',
  timeout: 30_000,
  // Authenticated specs share one rate-safe session; zz-sign-out.spec.ts must stay last.
  workers: 1,
  use: {
    baseURL: process.env.BAP_OPERATIONAL_BASE_URL ?? 'http://localhost:39100',
    trace: 'retain-on-failure',
  },
});
