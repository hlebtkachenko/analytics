import { defineConfig } from '@playwright/test';

export default defineConfig({
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  testDir: './tests/operational',
  timeout: 30_000,
  use: {
    baseURL: process.env.BAP_OPERATIONAL_BASE_URL ?? 'http://127.0.0.1:39100',
    trace: 'retain-on-failure',
  },
});
