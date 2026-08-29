import type { StorybookConfig } from '@storybook/react-vite';

const config: StorybookConfig = {
  addons: [
    '@storybook/addon-a11y',
    '@storybook/addon-docs',
    '@storybook/addon-links',
    '@storybook/addon-themes',
    '@storybook/addon-vitest',
  ],
  core: { disableTelemetry: true },
  framework: '@storybook/react-vite',
  stories: ['../src/**/*.mdx', '../src/**/*.stories.@(ts|tsx)'],
};

export default config;
