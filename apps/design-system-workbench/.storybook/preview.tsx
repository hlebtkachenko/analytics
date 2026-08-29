import type { Decorator, Preview } from '@storybook/react-vite';
import { FeatureFlags } from '@bap/design-system/react';
import { DesignSystemProvider } from '@bap/design-system/theme';
import type { CarbonTheme } from '@bap/design-system';
import { useEffect, type ReactNode } from 'react';
import '@bap/design-system/styles.scss';
import '@bap/design-system/fonts.scss';
import '@bap/design-system/charts.css';

import {
  carbonFeatureFlagProviderProps,
  carbonFeatureFlags,
  carbonThemes,
} from '../src/shared/catalog.js';

type FeatureFlagMode = 'release-default' | boolean;
type LayoutDirection = 'ltr' | 'rtl';

function modeValue(
  flag: string,
  defaultValue: boolean,
  storyFlags: Readonly<Record<string, boolean | undefined>>,
  globals: Readonly<Record<string, unknown>>,
) {
  const storyValue = storyFlags[flag];
  if (storyValue !== undefined) return storyValue;
  const globalValue = globals[flag];
  return typeof globalValue === 'boolean' ? globalValue : defaultValue;
}

function resolvedFlags(
  storyFlags: Readonly<Record<string, boolean | undefined>>,
  globals: Readonly<Record<string, unknown>>,
) {
  return Object.fromEntries(
    carbonFeatureFlags.map(({ defaultValue, flag }) => [
      flag,
      modeValue(flag, defaultValue, storyFlags, globals),
    ]),
  );
}

function WorkbenchCanvas({
  children,
  direction,
  motion,
}: Readonly<{
  children: ReactNode;
  direction: LayoutDirection;
  motion: 'full' | 'reduced';
}>) {
  useEffect(() => {
    document.documentElement.dir = direction;
    return () => {
      document.documentElement.dir = 'ltr';
    };
  }, [direction]);

  return (
    <div
      className="bap-workbench-canvas"
      data-workbench-direction={direction}
      data-workbench-motion={motion}
      dir={direction}
    >
      {children}
    </div>
  );
}

const withCarbon: Decorator = (Story, context) => {
  const direction: LayoutDirection =
    context.globals.direction === 'rtl' ? 'rtl' : 'ltr';
  const motion = context.globals.motion === 'reduced' ? 'reduced' : 'full';
  const requestedTheme = context.globals.theme;
  const theme = carbonThemes.includes(requestedTheme as CarbonTheme)
    ? (requestedTheme as CarbonTheme)
    : 'white';
  const storyFlags = (context.parameters.carbonFlags ?? {}) as Readonly<
    Record<string, boolean | undefined>
  >;
  const flags = resolvedFlags(storyFlags, context.globals);
  const providerFlags = Object.fromEntries(
    carbonFeatureFlagProviderProps.map(({ flag, name }) => [name, flags[flag]]),
  );

  return (
    <DesignSystemProvider theme={theme}>
      <FeatureFlags {...providerFlags} flags={flags}>
        <WorkbenchCanvas direction={direction} motion={motion}>
          <Story />
        </WorkbenchCanvas>
      </FeatureFlags>
    </DesignSystemProvider>
  );
};

const preview: Preview = {
  decorators: [withCarbon],
  globalTypes: {
    direction: {
      defaultValue: 'ltr',
      description: 'Workbench layout direction',
      toolbar: {
        icon: 'transfer',
        items: [
          { title: 'Left to right', value: 'ltr' },
          { title: 'Right to left', value: 'rtl' },
        ],
        title: 'Direction',
      },
    },
    motion: {
      defaultValue: 'full',
      description: 'Workbench motion preview',
      toolbar: {
        icon: 'mirror',
        items: [
          { title: 'Full motion', value: 'full' },
          { title: 'Reduced motion', value: 'reduced' },
        ],
        title: 'Motion',
      },
    },
    theme: {
      defaultValue: 'white',
      description: 'Carbon theme',
      toolbar: { icon: 'paintbrush', items: [...carbonThemes], title: 'Theme' },
    },
    ...Object.fromEntries(
      carbonFeatureFlags.map((flag) => [
        flag.flag,
        {
          defaultValue: 'release-default' as FeatureFlagMode,
          description: `Carbon feature flag, installed default: ${String(flag.defaultValue)}.`,
          toolbar: {
            icon: 'lightning',
            items: [
              { title: 'Release default', value: 'release-default' },
              { title: 'Enabled', value: true },
              { title: 'Disabled', value: false },
            ],
            title: flag.flag,
          },
        },
      ]),
    ),
  },
  parameters: {
    a11y: { test: 'error' },
    backgrounds: { disable: true },
    controls: { expanded: true },
    docs: { toc: true },
    options: {
      storySort: {
        order: ['Foundations', 'Components', 'Patterns', 'Explorers', 'Charts'],
      },
    },
    viewport: {
      viewports: {
        carbon320: {
          name: 'Carbon 320',
          styles: { height: '568px', width: '320px' },
          type: 'mobile',
        },
        carbon672: {
          name: 'Carbon 672',
          styles: { height: '768px', width: '672px' },
          type: 'tablet',
        },
        carbon1056: {
          name: 'Carbon 1056',
          styles: { height: '900px', width: '1056px' },
          type: 'desktop',
        },
        carbon1312: {
          name: 'Carbon 1312',
          styles: { height: '900px', width: '1312px' },
          type: 'desktop',
        },
        carbon1584: {
          name: 'Carbon 1584',
          styles: { height: '900px', width: '1584px' },
          type: 'desktop',
        },
      },
    },
  },
};

export default preview;
