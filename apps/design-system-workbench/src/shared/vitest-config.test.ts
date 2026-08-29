import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { expect, test } from 'vitest';

import storybookConfig from '../../.storybook/main.js';
import config from '../../vitest.config.js';

type TelemetryCore = Readonly<{ disableTelemetry?: boolean }>;

test('keeps Chromium-only tests out of the jsdom project', () => {
  expect(config.test?.exclude).toContain('src/**/*.browser.test.{ts,tsx}');
});

test('keeps Storybook telemetry disabled in config and scripts', async () => {
  const packageJson = JSON.parse(
    await readFile(resolve(process.cwd(), 'package.json'), 'utf8'),
  ) as { scripts: Record<string, string> };
  expect(
    (storybookConfig.core as TelemetryCore | undefined)?.disableTelemetry,
  ).toBe(true);
  for (const script of ['build', 'dev', 'test:browser']) {
    expect(packageJson.scripts[script]).toContain(
      'STORYBOOK_DISABLE_TELEMETRY=1',
    );
  }
});
