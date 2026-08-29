import { ChartFrame } from '@bap/design-system/charts';
import type { ComponentType } from 'react';

import type { ChartStoryDefinition } from './chart-fixtures.js';

export { chartStoryDefinitions } from './chart-fixtures.js';
export type { ChartStoryDefinition } from './chart-fixtures.js';

type ChartProps = Readonly<{ data: unknown; options: unknown }>;
type ChartComponent = ComponentType<ChartProps>;

export type ChartStoryControls = Readonly<{
  animations: boolean;
  height: '240px' | '320px' | '480px';
  legend: boolean;
  resizable: boolean;
  theme: 'white' | 'g10' | 'g90' | 'g100';
  toolbar: boolean;
}>;

export const chartStoryControls: ChartStoryControls = {
  animations: false,
  height: '320px',
  legend: false,
  resizable: false,
  theme: 'white',
  toolbar: false,
};

function optionRecord(value: unknown) {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}

export function withChartControls(
  options: unknown,
  controls: ChartStoryControls,
) {
  const base = optionRecord(options);
  return {
    ...base,
    animations: controls.animations,
    height: controls.height,
    legend: { ...optionRecord(base.legend), enabled: controls.legend },
    resizable: controls.resizable,
    theme: controls.theme,
    toolbar: { ...optionRecord(base.toolbar), enabled: controls.toolbar },
  };
}

export function withChartOptionPatch(
  options: unknown,
  patch: Readonly<Record<string, unknown>> | undefined,
) {
  const base = optionRecord(options);
  if (!patch) return base;
  return [...new Set([...Object.keys(base), ...Object.keys(patch)])].reduce<
    Record<string, unknown>
  >((next, key) => {
    const value = patch[key];
    const existing = base[key];
    next[key] =
      value && typeof value === 'object' && !Array.isArray(value)
        ? withChartOptionPatch(existing, value as Record<string, unknown>)
        : (value ?? existing);
    return next;
  }, {});
}

export function CarbonChartStory({
  animations = chartStoryControls.animations,
  definition,
  height = chartStoryControls.height,
  legend = chartStoryControls.legend,
  resizable = chartStoryControls.resizable,
  theme = chartStoryControls.theme,
  title,
  toolbar = chartStoryControls.toolbar,
  optionPatch,
  optionId,
}: Readonly<
  {
    definition: ChartStoryDefinition;
    optionId?: string;
    optionPatch?: Readonly<Record<string, unknown>>;
    title: string;
  } & Partial<ChartStoryControls>
>) {
  const RenderChart = definition.Chart as ChartComponent;
  const controls = { animations, height, legend, resizable, theme, toolbar };
  return (
    <div
      data-chart-height={height}
      data-chart-option-id={optionId}
      data-chart-render-option-id={optionId}
      data-chart-option-patch={
        optionPatch ? JSON.stringify(optionPatch) : undefined
      }
      data-chart-theme={theme}
    >
      <ChartFrame
        description="Abstract, non-business data with a table alternative."
        table={definition.table}
        title={title}
      >
        <RenderChart
          data={definition.data}
          options={withChartOptionPatch(
            withChartControls(definition.options, controls),
            optionPatch,
          )}
        />
      </ChartFrame>
    </div>
  );
}
