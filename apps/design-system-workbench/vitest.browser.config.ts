/* eslint-disable turbo/no-undeclared-env-vars */

import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { playwright } from '@vitest/browser-playwright';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { defineConfig } from 'vitest/config';

const directory = dirname(fileURLToPath(import.meta.url));
const storyDirectory = join(directory, 'src');
const browserProvider = playwright({
  contextOptions: { locale: 'en-US' },
  launchOptions: { args: ['--lang=en-US'] },
});

function countStoryFiles(path: string): number {
  return readdirSync(path, { withFileTypes: true }).reduce((count, entry) => {
    const entryPath = join(path, entry.name);
    if (entry.isDirectory()) return count + countStoryFiles(entryPath);
    return count + Number(/\.stories\.(ts|tsx)$/.test(entry.name));
  }, 0);
}

function browserShard() {
  const index = process.env.BAP_BROWSER_SHARD_INDEX;
  const total = process.env.BAP_BROWSER_SHARD_TOTAL;
  if (Boolean(index) !== Boolean(total)) {
    throw new Error(
      'Set BAP_BROWSER_SHARD_INDEX and BAP_BROWSER_SHARD_TOTAL together.',
    );
  }
  if (!index || !total) return undefined;

  const shardIndex = Number(index);
  const shardTotal = Number(total);
  if (
    !Number.isSafeInteger(shardIndex) ||
    !Number.isSafeInteger(shardTotal) ||
    shardIndex < 1 ||
    shardTotal < 1 ||
    shardIndex > shardTotal
  ) {
    throw new Error(
      'BAP browser shards must use a one-based index within total.',
    );
  }
  if (shardTotal > countStoryFiles(storyDirectory)) {
    throw new Error('BAP browser shard total exceeds discovered story files.');
  }
  return `${shardIndex}/${shardTotal}`;
}

export default defineConfig({
  test: {
    shard: browserShard(),
    projects: [
      {
        extends: true,
        plugins: [
          storybookTest({
            configDir: join(directory, '.storybook'),
          }),
        ],
        test: {
          name: 'storybook',
          browser: {
            enabled: true,
            headless: true,
            instances: [{ browser: 'chromium' }],
            provider: browserProvider,
          },
          fileParallelism: true,
          hookTimeout: 30_000,
          maxWorkers: process.env.CI ? 4 : 2,
          passWithNoTests: false,
          setupFiles: [join(directory, '.storybook', 'vitest.setup.ts')],
          testTimeout: 30_000,
        },
      },
      {
        extends: true,
        test: {
          browser: {
            enabled: true,
            headless: true,
            instances: [{ browser: 'chromium' }],
            provider: browserProvider,
            screenshotFailures: false,
          },
          include: ['src/**/*.browser.test.tsx'],
          maxWorkers: process.env.CI ? 4 : 2,
          name: 'browser-contracts',
          passWithNoTests: false,
          testTimeout: 30_000,
        },
      },
    ],
  },
});
