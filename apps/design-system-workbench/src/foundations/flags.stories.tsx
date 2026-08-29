import { Heading, Stack, Tile } from '@bap/design-system/react';
import type { Meta, StoryObj } from '@storybook/react-vite';

import {
  carbonFeatureFlagProviderProps,
  carbonFeatureFlags,
} from '../shared/catalog.js';

const meta = {
  component: Tile,
  title: 'Foundations/Feature flags',
} satisfies Meta<typeof Tile>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ReleaseDefaults: Story = {
  render: () => (
    <Stack gap={6}>
      <Heading>Release flag controls</Heading>
      <p>
        Select Release default in the toolbar to reset every installed Carbon
        flag deterministically to its pinned value.
      </p>
      {carbonFeatureFlags.map((flag) => (
        <Tile key={flag.flag}>
          <strong>{flag.flag}</strong>
          <p>Default: {String(flag.defaultValue)}</p>
          <p>
            {flag.providerProp
              ? `Runtime provider prop: ${flag.providerProp}`
              : 'No React FeatureFlags provider prop in this release.'}
          </p>
        </Tile>
      ))}
    </Stack>
  ),
};

export const RuntimeProviderProps: Story = {
  render: () => (
    <Stack gap={6}>
      <Heading>React FeatureFlags provider props</Heading>
      <p>
        All installed flags are controlled by the toolbar and FeatureFlags
        context. These entries also have direct React provider props.
      </p>
      <p>
        Some flags also affect Sass or build output, so verify generated CSS and
        application builds when adopting them.
      </p>
      {carbonFeatureFlagProviderProps.map((flag) => (
        <Tile key={flag.name}>
          <strong>{flag.name}</strong>
          <p>{flag.description}</p>
          <p>
            {flag.flag}, default: {String(flag.defaultValue)}
          </p>
        </Tile>
      ))}
    </Stack>
  ),
};

export const NativeDialog: Story = {
  parameters: { carbonFlags: { 'enable-dialog-element': true } },
  render: () => (
    <Tile>
      <Heading>Native dialog enabled</Heading>
      <p>This story pins its flag independently from the toolbar.</p>
    </Tile>
  ),
};
