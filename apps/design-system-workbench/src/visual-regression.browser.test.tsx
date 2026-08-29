import { Column, Grid, Modal, Stack } from '@bap/design-system/react';
import type { Decorator as StorybookDecorator } from '@storybook/react-vite';
import { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, test } from 'vitest';
import { page } from 'vitest/browser';

import preview from '../.storybook/preview.js';
import {
  CarbonChartStory,
  chartStoryDefinitions,
} from './charts/chart-stories.js';
import { Edge } from '@bap/design-system/charts';
import { componentStory } from './components/component-registry.js';
import { Overview } from './foundations/foundations.stories.js';
import { CarbonForAi } from './patterns/carbon-for-ai.stories.js';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

type DecoratorContext = Parameters<StorybookDecorator>[1];

const visualOptions = {
  comparatorName: 'pixelmatch' as const,
  comparatorOptions: {
    allowedMismatchedPixelRatio: 0.005,
    threshold: 0.2,
  },
  timeout: 10_000,
};

let root: Root | undefined;
let host: HTMLDivElement | undefined;

function decorated(
  children: ReactNode,
  theme: 'white' | 'g10' | 'g90' | 'g100',
) {
  const decorators = preview.decorators
    ? Array.isArray(preview.decorators)
      ? preview.decorators
      : [preview.decorators]
    : [];
  const decorator = decorators[0];
  if (!decorator) throw new Error('Carbon Storybook decorator is missing.');
  return decorator(() => <>{children}</>, {
    globals: { direction: 'ltr', motion: 'reduced', theme },
    parameters: {},
  } as unknown as DecoratorContext);
}

async function mount(
  testId: string,
  children: ReactNode,
  theme: 'white' | 'g10' | 'g90' | 'g100' = 'white',
) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root?.render(
      <main data-testid={testId}>{decorated(children, theme)}</main>,
    ),
  );
  await act(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await document.fonts.ready;
  return page.getByTestId(testId);
}

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
  await page.viewport(960, 720);
});

test('matches generated Button default and variant specimens', async () => {
  await page.viewport(960, 420);
  const button = componentStory('Button');
  const previousHash = window.location.hash;
  window.location.hash = '#api-kind-1';
  try {
    const target = await mount(
      'generated-button',
      <Stack gap={5}>
        <section>{button.Default.render?.({} as never, {} as never)}</section>
        <section>{button.Variants.render?.({} as never, {} as never)}</section>
      </Stack>,
    );
    await expect
      .element(target)
      .toMatchScreenshot(
        'generated-button-default-variants-white',
        visualOptions,
      );
  } finally {
    window.location.hash = previousHash;
  }
});

test('matches an open modal on a dark theme', async () => {
  await page.viewport(960, 520);
  const target = await mount(
    'open-modal',
    <Modal
      modalHeading="Neutral modal"
      modalLabel="Visual regression"
      onRequestClose={() => undefined}
      open
      passiveModal
    >
      A deterministic open state.
    </Modal>,
    'g100',
  );
  await expect
    .element(target)
    .toMatchScreenshot('modal-open-g100', visualOptions);
});

test('matches Grid and Column at the narrow reference viewport', async () => {
  await page.viewport(320, 640);
  const target = await mount(
    'grid-column-narrow',
    <Grid>
      <Column lg={8} md={4} sm={4}>
        <div className="cds--tile">Responsive Carbon grid column</div>
      </Column>
    </Grid>,
  );
  await expect
    .element(target)
    .toMatchScreenshot('grid-column-320-white', visualOptions);
});

test('matches a neutral Carbon chart with stable controls', async () => {
  await page.viewport(960, 560);
  const target = await mount(
    'chart',
    <CarbonChartStory
      animations={false}
      definition={chartStoryDefinitions.AreaChart}
      height="320px"
      legend={false}
      resizable={false}
      theme="g90"
      title="Area chart"
      toolbar={false}
    />,
    'g90',
  );
  await expect
    .element(target)
    .toMatchScreenshot('area-chart-g90', visualOptions);
});

test('matches a diagram primitive', async () => {
  await page.viewport(720, 360);
  const target = await mount(
    'diagram',
    <svg aria-label="Diagram primitive" height="180" role="img" width="640">
      <Edge
        source={{ x: 40, y: 90 }}
        target={{ x: 580, y: 90 }}
        variant="double"
      />
    </svg>,
  );
  await expect
    .element(target)
    .toMatchScreenshot('diagram-edge-double-white', visualOptions);
});

test('matches the Carbon for AI pattern on a dark theme', async () => {
  await page.viewport(960, 1100);
  const target = await mount(
    'carbon-for-ai',
    <CarbonForAi theme="g100" />,
    'g100',
  );
  await expect
    .element(target)
    .toMatchScreenshot('carbon-for-ai-g100', visualOptions);
});

test('matches the foundations reference view', async () => {
  await page.viewport(960, 720);
  const target = await mount(
    'foundations',
    Overview.render?.({} as never, {} as never) ?? null,
    'g10',
  );
  await expect
    .element(target)
    .toMatchScreenshot('foundations-overview-g10', visualOptions);
});
