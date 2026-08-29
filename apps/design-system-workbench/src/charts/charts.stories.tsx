import type { Meta, StoryObj } from '@storybook/react-vite';

import {
  CarbonChartStory,
  chartStoryControls,
  chartStoryDefinitions,
} from './chart-stories.js';
import { ChartOptionVariants } from './chart-option-variants.js';

const meta = {
  component: CarbonChartStory,
  title: 'Charts/Standard charts',
} satisfies Meta<typeof CarbonChartStory>;
export default meta;
type Story = StoryObj<typeof meta>;

const chartControls = {
  animations: { control: 'boolean' },
  definition: { table: { disable: true } },
  height: {
    control: 'select',
    options: ['240px', '320px', '480px'],
  },
  legend: { control: 'boolean' },
  resizable: { control: 'boolean' },
  theme: { control: 'select', options: ['white', 'g10', 'g90', 'g100'] },
  title: { table: { disable: true } },
  toolbar: { control: 'boolean' },
} as const;

function chartStory(
  definition: (typeof chartStoryDefinitions)[keyof typeof chartStoryDefinitions],
  title: string,
): Story {
  return {
    args: { ...chartStoryControls, definition, title },
    argTypes: chartControls,
  };
}

const chartA11yExceptions = {
  alluvial: {
    a11y: {
      config: { rules: [{ enabled: false, id: 'aria-prohibited-attr' }] },
    },
    docs: {
      description: {
        story:
          'Pinned Carbon Charts 1.27.18 assigns prohibited ARIA attributes to internal alluvial graph SVG elements. The labeled chart wrapper and equivalent table remain required.',
      },
    },
  },
  gauge: {
    a11y: { config: { rules: [{ enabled: false, id: 'svg-img-alt' }] } },
    docs: {
      description: {
        story:
          'Pinned Carbon Charts 1.27.18 renders an internal gauge SVG image without its own accessible name. The labeled chart wrapper and equivalent table remain required.',
      },
    },
  },
  heatmap: {
    a11y: {
      config: { rules: [{ enabled: false, id: 'aria-prohibited-attr' }] },
    },
    docs: {
      description: {
        story:
          'Pinned Carbon Charts 1.27.18 assigns prohibited ARIA attributes to internal heatmap SVG elements. The labeled chart wrapper and equivalent table remain required.',
      },
    },
  },
} as const;

export const Area = chartStory(chartStoryDefinitions.AreaChart, 'Area chart');
export const StackedArea = chartStory(
  chartStoryDefinitions.StackedAreaChart,
  'Stacked area chart',
);
export const GroupedBar = chartStory(
  chartStoryDefinitions.GroupedBarChart,
  'Grouped bar chart',
);
export const SimpleBar = chartStory(
  chartStoryDefinitions.SimpleBarChart,
  'Simple bar chart',
);
export const StackedBar = chartStory(
  chartStoryDefinitions.StackedBarChart,
  'Stacked bar chart',
);
export const Boxplot = chartStory(
  chartStoryDefinitions.BoxplotChart,
  'Boxplot chart',
);
export const Bubble = chartStory(
  chartStoryDefinitions.BubbleChart,
  'Bubble chart',
);
export const Bullet = chartStory(
  chartStoryDefinitions.BulletChart,
  'Bullet chart',
);
export const Choropleth = chartStory(
  chartStoryDefinitions.ChoroplethChart,
  'Choropleth chart',
);
export const Donut = chartStory(
  chartStoryDefinitions.DonutChart,
  'Donut chart',
);
export const Gauge = {
  ...chartStory(chartStoryDefinitions.GaugeChart, 'Gauge chart'),
  parameters: chartA11yExceptions.gauge,
};
export const Histogram = chartStory(
  chartStoryDefinitions.HistogramChart,
  'Histogram chart',
);
export const Line = chartStory(chartStoryDefinitions.LineChart, 'Line chart');
export const Lollipop = chartStory(
  chartStoryDefinitions.LollipopChart,
  'Lollipop chart',
);
export const Pie = chartStory(chartStoryDefinitions.PieChart, 'Pie chart');
export const Scatter = chartStory(
  chartStoryDefinitions.ScatterChart,
  'Scatter chart',
);
export const Meter = chartStory(
  chartStoryDefinitions.MeterChart,
  'Meter chart',
);
export const Radar = chartStory(
  chartStoryDefinitions.RadarChart,
  'Radar chart',
);
export const Combo = chartStory(
  chartStoryDefinitions.ComboChart,
  'Combo chart',
);
export const Tree = chartStory(chartStoryDefinitions.TreeChart, 'Tree chart');
export const Treemap = chartStory(
  chartStoryDefinitions.TreemapChart,
  'Treemap chart',
);
export const CirclePack = chartStory(
  chartStoryDefinitions.CirclePackChart,
  'Circle pack chart',
);
export const WordCloud = chartStory(
  chartStoryDefinitions.WordCloudChart,
  'Word cloud chart',
);
export const Alluvial = {
  ...chartStory(chartStoryDefinitions.AlluvialChart, 'Alluvial chart'),
  parameters: chartA11yExceptions.alluvial,
};
export const Heatmap = {
  ...chartStory(chartStoryDefinitions.HeatmapChart, 'Heatmap chart'),
  parameters: chartA11yExceptions.heatmap,
};
export const ExperimentalChoropleth = chartStory(
  chartStoryDefinitions.ExperimentalChoroplethChart,
  'Experimental choropleth chart',
);

export const AllOptions: Story = {
  args: {
    ...chartStoryControls,
    definition: chartStoryDefinitions.AreaChart,
    title: 'Chart option variants',
  },
  parameters: {
    a11y: {
      config: {
        rules: [
          { enabled: false, id: 'aria-prohibited-attr' },
          { enabled: false, id: 'svg-img-alt' },
        ],
      },
    },
    docs: {
      description: {
        story:
          'This selector includes the documented Carbon Charts 1.27.18 alluvial, heatmap, and gauge internal-SVG exceptions. Every selected chart retains its labeled wrapper and equivalent table.',
      },
    },
  },
  render: () => <ChartOptionVariants />,
};
