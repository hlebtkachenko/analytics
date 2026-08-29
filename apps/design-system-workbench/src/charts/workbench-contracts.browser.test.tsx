import { CardNode, Edge, ShapeNode } from '@bap/design-system/charts';
import type { Decorator as StorybookDecorator } from '@storybook/react-vite';
import { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test, vi } from 'vitest';

import preview from '../../.storybook/preview.js';
import {
  chartOptionCoverage,
  chartOptionPatch,
  ChartOptionVariants,
} from './chart-option-variants.js';
import {
  CarbonChartStory,
  chartStoryDefinitions,
  type ChartStoryDefinition,
} from './chart-stories.js';
import {
  diagramPropCoverage,
  DiagramPropPreview,
  DiagramPropVariants,
} from './diagram-prop-variants.js';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

type DecoratorContext = Parameters<StorybookDecorator>[1];

async function mount(content: ReactNode) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(content));
  return {
    host,
    async unmount() {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

test('renders a changed common Carbon chart control set', async () => {
  const mounted = await mount(
    <CarbonChartStory
      animations
      definition={chartStoryDefinitions.AreaChart}
      height="480px"
      legend
      resizable
      theme="g90"
      title="Area chart"
      toolbar
    />,
  );
  await expect
    .poll(() => mounted.host.querySelectorAll('svg').length)
    .toBeGreaterThan(0);
  expect(mounted.host.querySelector('[data-chart-theme="g90"]')).not.toBeNull();
  expect(
    mounted.host.querySelector('[data-chart-height="480px"]'),
  ).not.toBeNull();
  expect(mounted.host.querySelector('table')).not.toBeNull();
  await mounted.unmount();
});

test('renders visible family-specific marks for every Carbon chart fixture', async () => {
  for (const [name, definition] of Object.entries(chartStoryDefinitions) as [
    string,
    ChartStoryDefinition,
  ][]) {
    const mounted = await mount(
      <CarbonChartStory definition={definition} title={name} />,
    );
    try {
      await expect
        .poll(() => mounted.host.querySelectorAll('svg').length)
        .toBeGreaterThan(0);
      for (const mark of definition.marks) {
        try {
          await expect
            .poll(() => mounted.host.querySelectorAll(mark.selector).length, {
              interval: 100,
              timeout: 10_000,
            })
            .toBeGreaterThanOrEqual(mark.minimum);
        } catch (error) {
          throw new Error(
            `${name} is missing ${mark.minimum} ${mark.selector} marks: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        const visibleMarks = () =>
          [
            ...mounted.host.querySelectorAll<SVGGraphicsElement>(mark.selector),
          ].filter((element) => {
            const box = element.getBBox();
            if (mark.geometry === 'width') return box.width > 0;
            if (mark.geometry === 'height') return box.height > 0;
            return box.width > 0 && box.height > 0;
          });
        try {
          await expect
            .poll(() => visibleMarks().length, {
              interval: 100,
              timeout: 10_000,
            })
            .toBeGreaterThanOrEqual(mark.visibleMinimum ?? mark.minimum);
        } catch (error) {
          const geometry = [
            ...mounted.host.querySelectorAll<SVGGraphicsElement>(mark.selector),
          ].map((element) => {
            const box = element.getBBox();
            return { height: box.height, width: box.width };
          });
          throw new Error(
            `${name} rendered degenerate ${mark.selector} marks: ${JSON.stringify(geometry)}. ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        const elements = [
          ...mounted.host.querySelectorAll<SVGGraphicsElement>(mark.selector),
        ];
        if (mark.maximum !== undefined) {
          expect(
            elements.length,
            `${name} rendered an invalid ${mark.selector} mark.`,
          ).toBeLessThanOrEqual(mark.maximum);
        }
        if (mark.classNameIncludes) {
          expect(
            elements.every((element) =>
              element
                .getAttribute('class')
                ?.includes(mark.classNameIncludes as string),
            ),
            `${name} did not apply a data-bound ${mark.classNameIncludes} class.`,
          ).toBe(true);
        }
        const markText = mark.text;
        if (markText) {
          await expect
            .poll(
              () =>
                elements.some((element) =>
                  element.textContent?.includes(markText),
                ),
              { interval: 100, timeout: 10_000 },
            )
            .toBe(true);
        }
      }
      expect(mounted.host.querySelector('table')).not.toBeNull();
    } finally {
      await mounted.unmount();
    }
  }
});

test('uses the BubbleChart radius field to render distinct positive bubbles', async () => {
  const definition = chartStoryDefinitions.BubbleChart;
  const fixtureRadii = (
    definition.data as readonly Readonly<{ radius: number }>[]
  ).map(({ radius }) => radius);
  expect(new Set(fixtureRadii).size).toBeGreaterThanOrEqual(2);
  const mounted = await mount(
    <CarbonChartStory definition={definition} title="Bubble chart" />,
  );
  try {
    await expect
      .poll(
        () =>
          new Set(
            [...mounted.host.querySelectorAll<SVGCircleElement>('circle.dot')]
              .map((circle) => Number(circle.getAttribute('r')))
              .filter((radius) => Number.isFinite(radius) && radius > 0),
          ).size,
        { interval: 100, timeout: 10_000 },
      )
      .toBeGreaterThanOrEqual(2);
  } finally {
    await mounted.unmount();
  }
});

test('mounts every covered Carbon chart option literal without console errors', async () => {
  const errors: string[] = [];
  const consoleError = vi
    .spyOn(console, 'error')
    .mockImplementation((...args) => {
      errors.push(args.map(String).join(' '));
    });
  try {
    for (const record of chartOptionCoverage) {
      if (
        record.executionStatus !== 'covered' ||
        !record.chart ||
        !record.path
      ) {
        continue;
      }
      try {
        const mounted = await mount(
          <CarbonChartStory
            definition={chartStoryDefinitions[record.chart]}
            optionId={record.id}
            optionPatch={chartOptionPatch(record.path, record.value)}
            title={`${record.declaration}.${record.property}`}
          />,
        );
        await expect
          .poll(() => mounted.host.querySelectorAll('svg').length)
          .toBeGreaterThan(0);
        expect(mounted.host.querySelector('table')).not.toBeNull();
        await mounted.unmount();
      } catch (error) {
        throw new Error(
          `${record.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  } finally {
    consoleError.mockRestore();
  }
  expect(errors).toEqual([]);
});

test('selects a chart option variant from a deep-link fragment', async () => {
  const record = chartOptionCoverage.find(
    (candidate) => candidate.id === 'api-axisoptions-scaletype-3',
  );
  if (!record) throw new Error('The labels scale type literal is missing.');
  window.location.hash = record.id;
  const mounted = await mount(<ChartOptionVariants />);
  await expect
    .poll(() =>
      mounted.host
        .querySelector('[data-chart-option-selected]')
        ?.getAttribute('data-chart-option-selected'),
    )
    .toBe(record.id);
  expect(
    mounted.host.querySelector(`[data-chart-render-option-id="${record.id}"]`),
  ).not.toBeNull();
  await expect
    .poll(() =>
      mounted.host
        .querySelector(`[data-chart-render-option-id="${record.id}"]`)
        ?.getAttribute('data-chart-option-patch'),
    )
    .toContain('labels');
  const next = chartOptionCoverage.find(
    (candidate) =>
      candidate.executionStatus === 'covered' &&
      candidate.id !== record.id &&
      candidate.chart &&
      candidate.path,
  );
  if (!next) throw new Error('A second chart option literal is missing.');
  const selectedButton = mounted.host.querySelector(
    `[data-chart-option-id="${next.id}"] button`,
  );
  if (!(selectedButton instanceof HTMLButtonElement)) {
    throw new Error('The selected chart option button is missing.');
  }
  await act(async () => selectedButton.click());
  expect(window.location.hash).toBe(`#${next.id}`);
  await expect
    .poll(() =>
      mounted.host
        .querySelector('[data-chart-option-selected]')
        ?.getAttribute('data-chart-option-selected'),
    )
    .toBe(next.id);
  await act(async () => {
    window.location.hash = record.id;
  });
  await expect
    .poll(() =>
      mounted.host
        .querySelector('[data-chart-option-selected]')
        ?.getAttribute('data-chart-option-selected'),
    )
    .toBe(record.id);
  await mounted.unmount();
  window.location.hash = '';
});

test('mounts every covered Carbon diagram prop literal without console errors', async () => {
  const errors: string[] = [];
  const consoleError = vi
    .spyOn(console, 'error')
    .mockImplementation((...args) => errors.push(args.map(String).join(' ')));
  try {
    for (const record of diagramPropCoverage) {
      const mounted = await mount(<DiagramPropPreview record={record} />);
      expect(
        mounted.host.querySelector(
          'svg, .cds--cc--shape-node, .cds--cc--card-node',
        ),
      ).not.toBeNull();
      await mounted.unmount();
    }
  } finally {
    consoleError.mockRestore();
  }
  expect(errors).toEqual([]);
});

test('selects a diagram prop variant from a deep-link fragment', async () => {
  const record = diagramPropCoverage.find(
    (candidate) => candidate.id === 'api-edge-variant-4',
  );
  if (!record) throw new Error('The Edge double literal is missing.');
  window.location.hash = record.id;
  const mounted = await mount(<DiagramPropVariants />);
  await expect
    .poll(() =>
      mounted.host
        .querySelector('[data-diagram-prop-selected]')
        ?.getAttribute('data-diagram-prop-selected'),
    )
    .toBe(record.id);
  expect(
    mounted.host.querySelector(`[data-diagram-prop-preview="${record.id}"]`),
  ).not.toBeNull();
  const next = diagramPropCoverage.find(
    (candidate) => candidate.id === 'api-edge-variant-0',
  );
  if (!next) throw new Error('The Edge dash small literal is missing.');
  const selectedButton = mounted.host.querySelector(
    `[data-diagram-prop-id="${next.id}"] button`,
  );
  if (!(selectedButton instanceof HTMLButtonElement)) {
    throw new Error('The selected diagram prop button is missing.');
  }
  await act(async () => selectedButton.click());
  expect(window.location.hash).toBe(`#${next.id}`);
  await act(async () => {
    window.location.hash = record.id;
  });
  await expect
    .poll(() =>
      mounted.host
        .querySelector('[data-diagram-prop-selected]')
        ?.getAttribute('data-diagram-prop-selected'),
    )
    .toBe(record.id);
  await mounted.unmount();
  window.location.hash = '';
});

test('renders every documented diagram variant and semantic node form', async () => {
  const edgeVariants = [
    'dash-sm',
    'dash-md',
    'dash-lg',
    'dash-xl',
    'double',
    'tunnel',
  ];
  const mounted = await mount(
    <>
      <svg aria-label="Edge variants" role="img">
        {edgeVariants.map((variant, index) => (
          <Edge
            key={variant}
            source={{ x: 0, y: index * 10 }}
            target={{ x: 100, y: index * 10 }}
            variant={variant}
          />
        ))}
      </svg>
      <ShapeNode
        bodyPosition="static"
        position="relative"
        renderIcon={<span aria-hidden>●</span>}
        shape="circle"
        tag="div"
        title="Circle"
      />
      <ShapeNode
        bodyPosition="static"
        onClick={() => undefined}
        position="relative"
        renderIcon={<span aria-hidden>●</span>}
        shape="square"
        tag="button"
        title="Square"
      />
      <ShapeNode
        bodyPosition="static"
        href="#shape"
        position="relative"
        renderIcon={<span aria-hidden>●</span>}
        shape="rounded-square"
        tag="a"
        title="Rounded square"
      />
      <CardNode>Static card</CardNode>
      <CardNode onClick={() => undefined} tag="button">
        Button card
      </CardNode>
      <CardNode color="var(--cds-link-primary)" href="#card" stacked>
        Linked card
      </CardNode>
    </>,
  );
  for (const variant of edgeVariants) {
    expect(
      mounted.host.querySelector(`.cds--cc--edge--${variant}`),
    ).not.toBeNull();
  }
  expect(
    mounted.host.querySelector('.cds--cc--shape-node--circle'),
  ).not.toBeNull();
  expect(
    mounted.host.querySelector('.cds--cc--shape-node--square'),
  ).not.toBeNull();
  expect(
    mounted.host.querySelector('.cds--cc--shape-node--rounded-square'),
  ).not.toBeNull();
  expect(
    mounted.host.querySelector('button.cds--cc--card-node'),
  ).not.toBeNull();
  expect(mounted.host.querySelector('a.cds--cc--card-node')).not.toBeNull();
  expect(
    mounted.host.querySelector('.cds--cc--card-node--stacked'),
  ).not.toBeNull();
  await mounted.unmount();
});

test('applies the deterministic reduced-motion preview mode', async () => {
  const decorators = preview.decorators
    ? Array.isArray(preview.decorators)
      ? preview.decorators
      : [preview.decorators]
    : [];
  const decorator = decorators[0];
  if (!decorator) throw new Error('Carbon Storybook decorator is missing.');
  const mounted = await mount(
    decorator(() => <span>Motion preview</span>, {
      globals: { motion: 'reduced' },
      parameters: {},
    } as unknown as DecoratorContext),
  );
  expect(preview.globalTypes?.motion).toMatchObject({ defaultValue: 'full' });
  expect(
    mounted.host.querySelector('[data-workbench-motion="reduced"]'),
  ).not.toBeNull();
  await mounted.unmount();
});

test('applies and resets the deterministic layout direction', async () => {
  const decorators = preview.decorators
    ? Array.isArray(preview.decorators)
      ? preview.decorators
      : [preview.decorators]
    : [];
  const decorator = decorators[0];
  if (!decorator) throw new Error('Carbon Storybook decorator is missing.');
  const rtl = await mount(
    decorator(() => <span>Direction preview</span>, {
      globals: { direction: 'rtl' },
      parameters: {},
    } as unknown as DecoratorContext),
  );
  expect(preview.globalTypes?.direction).toMatchObject({ defaultValue: 'ltr' });
  expect(document.documentElement.dir).toBe('rtl');
  expect(
    rtl.host.querySelector('[data-workbench-direction="rtl"]'),
  ).not.toBeNull();
  await rtl.unmount();
  expect(document.documentElement.dir).toBe('ltr');

  const ltr = await mount(
    decorator(() => <span>Direction preview</span>, {
      globals: { direction: 'ltr' },
      parameters: {},
    } as unknown as DecoratorContext),
  );
  expect(document.documentElement.dir).toBe('ltr');
  expect(
    ltr.host.querySelector('[data-workbench-direction="ltr"]'),
  ).not.toBeNull();
  await ltr.unmount();
});
