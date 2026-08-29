import {
  carbonFeatureFlagDefaults,
  carbonFeatureFlags,
} from '@bap/design-system';
import { useFeatureFlags } from '@bap/design-system/react';
import type { Decorator as StorybookDecorator } from '@storybook/react-vite';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test } from 'vitest';

import preview from '../../.storybook/preview.js';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

type DecoratorContext = Parameters<StorybookDecorator>[1];
type StorybookGlobals = Record<string, boolean | 'release-default'>;

function FlagValues() {
  const scope = useFeatureFlags();
  const values = Object.fromEntries(
    carbonFeatureFlags.map(({ flag }) => [flag, Boolean(scope.enabled(flag))]),
  );
  return <output>{JSON.stringify(values)}</output>;
}

async function valuesForStorybook(
  globals: Readonly<StorybookGlobals>,
  carbonFlags: Readonly<Record<string, boolean>> = {},
) {
  const decorators = preview.decorators
    ? Array.isArray(preview.decorators)
      ? preview.decorators
      : [preview.decorators]
    : [];
  const decorator = decorators[0];
  if (!decorator) throw new Error('Carbon Storybook decorator is missing.');
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      decorator(() => <FlagValues />, {
        globals,
        parameters: { carbonFlags },
      } as unknown as DecoratorContext),
    );
  });
  const values = JSON.parse(host.textContent ?? '{}');
  await act(async () => root.unmount());
  host.remove();
  return values as Record<string, boolean>;
}

test('switches and resets every installed Carbon feature flag in Storybook', async () => {
  const defaults = carbonFeatureFlagDefaults;
  const releaseDefaults: StorybookGlobals = Object.fromEntries(
    carbonFeatureFlags.map(({ flag }) => [flag, 'release-default']),
  );
  expect(carbonFeatureFlags).toHaveLength(18);
  expect(Object.keys(defaults)).toHaveLength(18);
  expect(
    Object.keys(preview.globalTypes ?? {}).filter((name) =>
      carbonFeatureFlags.some((flag) => flag.flag === name),
    ),
  ).toHaveLength(18);
  expect(await valuesForStorybook(releaseDefaults)).toEqual(defaults);

  for (const { defaultValue, flag } of carbonFeatureFlags) {
    expect(
      (await valuesForStorybook({ ...releaseDefaults, [flag]: true }))[flag],
    ).toBe(true);
    expect(
      (await valuesForStorybook({ ...releaseDefaults, [flag]: false }))[flag],
    ).toBe(false);
    expect(
      (
        await valuesForStorybook(
          { ...releaseDefaults, [flag]: !defaultValue },
          { [flag]: defaultValue },
        )
      )[flag],
    ).toBe(defaultValue);
    expect((await valuesForStorybook(releaseDefaults))[flag]).toBe(
      defaultValue,
    );
  }
});
