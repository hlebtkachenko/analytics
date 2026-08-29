import {
  AlluvialChart,
  AreaChart,
  BoxplotChart,
  BubbleChart,
  BulletChart,
  ChoroplethChart,
  CirclePackChart,
  ComboChart,
  DonutChart,
  ExperimentalChoroplethChart,
  GaugeChart,
  GroupedBarChart,
  HeatmapChart,
  HistogramChart,
  LineChart,
  LollipopChart,
  MeterChart,
  PieChart,
  RadarChart,
  ScatterChart,
  SimpleBarChart,
  StackedAreaChart,
  StackedBarChart,
  TreeChart,
  TreemapChart,
  WordCloudChart,
} from '@bap/design-system/charts';
import type { ChartTable } from '@bap/design-system/charts';

export type ChartStoryDefinition = Readonly<{
  Chart: unknown;
  data: unknown;
  marks: readonly Readonly<{
    classNameIncludes?: string;
    geometry?: 'both' | 'height' | 'width';
    maximum?: number;
    minimum: number;
    selector: string;
    text?: string;
    visibleMinimum?: number;
  }>[];
  options: unknown;
  table: ChartTable;
}>;

function baseChartOptions(title: string, svgAriaLabel: string) {
  return {
    accessibility: { svgAriaLabel },
    animations: false,
    height: '320px',
    legend: { enabled: false },
    resizable: false,
    title,
    toolbar: { enabled: false },
  };
}

function chartTable(
  label: string,
  columns: readonly Readonly<{ key: string; label: string }>[],
  rows: readonly Readonly<Record<string, number | string>>[],
): ChartTable {
  return {
    columns,
    label,
    rows: rows.map((values, index) => ({ id: `row-${index + 1}`, values })),
  };
}

function dateRows(
  rows: readonly Readonly<{ date: Date; group: string; value: number }>[],
) {
  return rows.map(({ date, group, value }) => ({
    date: date.toISOString().slice(0, 10),
    group,
    value,
  }));
}

function hierarchyRows(
  rows: readonly Readonly<{
    children: readonly Readonly<{ name: string; value: number }>[];
    name: string;
  }>[],
) {
  return rows.flatMap(({ children, name: parent }) =>
    children.map(({ name: child, value }) => ({ child, parent, value })),
  );
}

const timeData = [
  { date: new Date('2025-01-01T00:00:00.000Z'), group: 'Series A', value: 18 },
  { date: new Date('2025-02-01T00:00:00.000Z'), group: 'Series A', value: 26 },
  { date: new Date('2025-03-01T00:00:00.000Z'), group: 'Series A', value: 22 },
];

const timeOptions = {
  accessibility: { svgAriaLabel: 'Neutral time series' },
  animations: false,
  axes: {
    bottom: { mapsTo: 'date', scaleType: 'time' },
    left: { mapsTo: 'value', scaleType: 'linear' },
  },
  height: '320px',
  legend: { enabled: false },
  resizable: false,
  title: 'Neutral time series',
  toolbar: { enabled: false },
};

const timeTable = {
  columns: [
    { key: 'date', label: 'Date' },
    { key: 'group', label: 'Group' },
    { key: 'value', label: 'Value' },
  ],
  label: 'Neutral time series data',
  rows: [
    {
      id: 'time-1',
      values: { date: '2025-01-01', group: 'Series A', value: 18 },
    },
    {
      id: 'time-2',
      values: { date: '2025-02-01', group: 'Series A', value: 26 },
    },
    {
      id: 'time-3',
      values: { date: '2025-03-01', group: 'Series A', value: 22 },
    },
  ],
} as const;

const geographicData = [{ id: 'RA', name: 'Region Alpha', value: 42 }] as const;

const geographicOptions = {
  accessibility: { svgAriaLabel: 'Neutral regional map' },
  animations: false,
  geoData: {
    arcs: [
      [
        [0, 0],
        [90, 0],
        [0, 45],
        [-90, 0],
        [0, -45],
      ],
    ],
    objects: {
      countries: {
        geometries: [
          {
            arcs: [[0]],
            properties: { NAME: 'Region Alpha' },
            type: 'Polygon',
          },
        ],
        type: 'GeometryCollection',
      },
    },
    type: 'Topology',
  },
  height: '320px',
  resizable: false,
  thematic: { projection: 'geoMercator' },
  title: 'Neutral regional map',
  toolbar: { enabled: false },
} as const;

const geographicTable = {
  columns: [
    { key: 'id', label: 'Region ID' },
    { key: 'name', label: 'Region name' },
    { key: 'value', label: 'Value' },
  ],
  label: 'Neutral regional map data',
  rows: [
    {
      id: 'region-alpha',
      values: { id: 'RA', name: 'Region Alpha', value: 42 },
    },
  ],
} as const;

const alluvialData = [
  { source: 'Source A', target: 'Target A', value: 8 },
  { source: 'Source A', target: 'Target B', value: 5 },
  { source: 'Source B', target: 'Target A', value: 3 },
  { source: 'Source B', target: 'Target B', value: 6 },
] as const;

const alluvialOptions = {
  accessibility: { svgAriaLabel: 'Neutral alluvial flow' },
  alluvial: {
    nodes: [
      { category: 'Source', name: 'Source A' },
      { category: 'Source', name: 'Source B' },
      { category: 'Target', name: 'Target A' },
      { category: 'Target', name: 'Target B' },
    ],
  },
  animations: false,
  height: '320px',
  resizable: false,
  title: 'Neutral alluvial flow',
  toolbar: { enabled: false },
} as const;

const alluvialTable = {
  columns: [
    { key: 'source', label: 'Source' },
    { key: 'target', label: 'Target' },
    { key: 'value', label: 'Value' },
  ],
  label: 'Neutral alluvial data',
  rows: alluvialData.map((row) => ({
    id: `${row.source}-${row.target}`,
    values: row,
  })),
} as const;

const treeData = [
  {
    children: [
      {
        children: [
          { name: 'Leaf A', value: 8 },
          { name: 'Leaf B', value: 5 },
        ],
        name: 'Branch A',
      },
      { name: 'Branch B', value: 6 },
    ],
    name: 'Root',
  },
] as const;

const treeOptions = {
  accessibility: { svgAriaLabel: 'Neutral tree' },
  animations: false,
  height: '320px',
  resizable: false,
  title: 'Neutral tree',
  tree: { rootTitle: 'Root' },
  toolbar: { enabled: false },
} as const;

function treeRows() {
  const rows: Record<string, number | string>[] = [];
  for (const { children, name: root } of treeData) {
    for (const branch of children) {
      if ('children' in branch) {
        for (const { name: leaf, value } of branch.children) {
          rows.push({ branch: branch.name, leaf, root, value });
        }
      } else {
        rows.push({
          branch: branch.name,
          leaf: branch.name,
          root,
          value: branch.value,
        });
      }
    }
  }
  return rows;
}

const treeTable = chartTable(
  'Neutral tree leaf data',
  [
    { key: 'root', label: 'Root' },
    { key: 'branch', label: 'Branch' },
    { key: 'leaf', label: 'Leaf' },
    { key: 'value', label: 'Value' },
  ],
  treeRows(),
);

const histogramData = [
  { group: 'Series A', value: 12 },
  { group: 'Series A', value: 18 },
  { group: 'Series A', value: 27 },
  { group: 'Series B', value: 16 },
  { group: 'Series B', value: 22 },
  { group: 'Series B', value: 31 },
] as const;

const histogramOptions = {
  accessibility: { svgAriaLabel: 'Neutral histogram' },
  animations: false,
  axes: {
    bottom: {
      bins: 3,
      limitDomainToBins: true,
      mapsTo: 'value',
      title: 'Value',
    },
    left: {
      binned: true,
      scaleType: 'linear',
      stacked: true,
      title: 'Frequency',
    },
  },
  height: '320px',
  resizable: false,
  title: 'Neutral histogram',
  toolbar: { enabled: false },
} as const;

const histogramTable = {
  columns: [
    { key: 'group', label: 'Group' },
    { key: 'value', label: 'Value' },
  ],
  label: 'Neutral histogram data',
  rows: histogramData.map((row, index) => ({
    id: `${row.group}-${index}`,
    values: row,
  })),
} as const;

const radarOptions = {
  accessibility: { svgAriaLabel: 'Neutral radar chart' },
  animations: false,
  data: { groupMapsTo: 'group' },
  height: '320px',
  legend: { enabled: false },
  radar: {
    axes: { angle: 'key', value: 'value' },
    maxValue: 50,
  },
  resizable: false,
  title: 'Neutral radar chart',
  toolbar: { enabled: false },
} as const;

const radarData = [
  { group: 'Series A', key: 'North', value: 42 },
  { group: 'Series A', key: 'South', value: 28 },
  { group: 'Series A', key: 'East', value: 35 },
  { group: 'Series B', key: 'North', value: 31 },
  { group: 'Series B', key: 'South', value: 39 },
  { group: 'Series B', key: 'East', value: 24 },
] as const;

const radarTable = {
  columns: [
    { key: 'group', label: 'Series' },
    { key: 'key', label: 'Direction' },
    { key: 'value', label: 'Value' },
  ],
  label: 'Neutral radar chart data',
  rows: radarData.map((row, index) => ({
    id: `radar-${index}`,
    values: row,
  })),
} as const;

const comboData = [
  { group: 'Bars', key: 'Alpha', value: 14 },
  { group: 'Bars', key: 'Beta', value: 22 },
  { group: 'Bars', key: 'Gamma', value: 18 },
  { group: 'Line', key: 'Alpha', value: 19 },
  { group: 'Line', key: 'Beta', value: 16 },
  { group: 'Line', key: 'Gamma', value: 24 },
] as const;

const comboOptions = {
  accessibility: { svgAriaLabel: 'Neutral combo chart' },
  animations: false,
  axes: {
    bottom: { mapsTo: 'key', scaleType: 'labels', title: 'Category' },
    left: { mapsTo: 'value', scaleType: 'linear', title: 'Value' },
  },
  comboChartTypes: [
    { correspondingDatasets: ['Bars'], type: 'simple-bar' },
    { correspondingDatasets: ['Line'], type: 'line' },
  ],
  height: '320px',
  resizable: false,
  title: 'Neutral combo chart',
  toolbar: { enabled: false },
} as const;

const comboTable = {
  columns: [
    { key: 'group', label: 'Series' },
    { key: 'key', label: 'Category' },
    { key: 'value', label: 'Value' },
  ],
  label: 'Neutral combo data',
  rows: comboData.map((row, index) => ({
    id: `${row.group}-${index}`,
    values: row,
  })),
} as const;

const areaData = [
  { date: new Date('2025-01-01T00:00:00.000Z'), group: 'Alpha', value: 18 },
  { date: new Date('2025-02-01T00:00:00.000Z'), group: 'Alpha', value: 26 },
  { date: new Date('2025-03-01T00:00:00.000Z'), group: 'Alpha', value: 22 },
  { date: new Date('2025-01-01T00:00:00.000Z'), group: 'Beta', value: 12 },
  { date: new Date('2025-02-01T00:00:00.000Z'), group: 'Beta', value: 19 },
  { date: new Date('2025-03-01T00:00:00.000Z'), group: 'Beta', value: 17 },
] as const;
const areaOptions = {
  ...baseChartOptions('Neutral area trend', 'Neutral area trend'),
  axes: {
    bottom: { mapsTo: 'date', scaleType: 'time' },
    left: { mapsTo: 'value', scaleType: 'linear' },
  },
};
const areaTable = chartTable(
  'Neutral area trend data',
  [
    { key: 'date', label: 'Date' },
    { key: 'group', label: 'Series' },
    { key: 'value', label: 'Value' },
  ],
  dateRows(areaData),
);

const boxplotData = [
  { group: 'Alpha', key: 'Observation 1', value: 12 },
  { group: 'Alpha', key: 'Observation 2', value: 15 },
  { group: 'Alpha', key: 'Observation 3', value: 18 },
  { group: 'Alpha', key: 'Observation 4', value: 22 },
  { group: 'Alpha', key: 'Observation 5', value: 25 },
  { group: 'Beta', key: 'Observation 1', value: 9 },
  { group: 'Beta', key: 'Observation 2', value: 13 },
  { group: 'Beta', key: 'Observation 3', value: 17 },
  { group: 'Beta', key: 'Observation 4', value: 21 },
  { group: 'Beta', key: 'Observation 5', value: 28 },
] as const;
const boxplotOptions = {
  ...baseChartOptions(
    'Neutral boxplot distribution',
    'Neutral boxplot distribution',
  ),
  axes: {
    bottom: { mapsTo: 'value', scaleType: 'linear' },
    left: { mapsTo: 'group', scaleType: 'labels' },
  },
};
const boxplotTable = chartTable(
  'Neutral boxplot observations',
  [
    { key: 'group', label: 'Group' },
    { key: 'key', label: 'Observation' },
    { key: 'value', label: 'Observed value' },
  ],
  boxplotData,
);

const bubbleData = [
  { group: 'Alpha', radius: 12, x: 14, y: 36 },
  { group: 'Alpha', radius: 20, x: 28, y: 24 },
  { group: 'Beta', radius: 16, x: 42, y: 48 },
  { group: 'Beta', radius: 28, x: 58, y: 32 },
] as const;
const bubbleOptions = {
  ...baseChartOptions(
    'Neutral bubble relationship',
    'Neutral bubble relationship',
  ),
  axes: {
    bottom: { mapsTo: 'x', scaleType: 'linear' },
    left: { mapsTo: 'y', scaleType: 'linear' },
  },
  bubble: { radiusLabel: 'Magnitude', radiusMapsTo: 'radius' },
};
const bubbleTable = chartTable(
  'Neutral bubble chart data',
  [
    { key: 'group', label: 'Group' },
    { key: 'x', label: 'X value' },
    { key: 'y', label: 'Y value' },
    { key: 'radius', label: 'Magnitude' },
  ],
  bubbleData,
);

const bulletData = [
  {
    group: 'Alpha',
    marker: 100,
    ranges: [30, 60, 100],
    title: 'Alpha measure',
    value: 64,
  },
  {
    group: 'Beta',
    marker: 110,
    ranges: [35, 65, 100],
    title: 'Beta measure',
    value: 73,
  },
] as const;
const bulletOptions = {
  ...baseChartOptions('Neutral bullet measures', 'Neutral bullet measures'),
  axes: {
    bottom: { mapsTo: 'title', scaleType: 'labels' },
    left: {
      extendLinearDomainBy: 'marker',
      mapsTo: 'value',
      scaleType: 'linear',
    },
  },
  bullet: { performanceAreaTitles: ['Low', 'Target range', 'High'] },
};
const bulletTable = chartTable(
  'Neutral bullet chart data',
  [
    { key: 'title', label: 'Measure' },
    { key: 'group', label: 'Group' },
    { key: 'value', label: 'Value' },
    { key: 'marker', label: 'Target' },
    { key: 'ranges', label: 'Ranges' },
  ],
  bulletData.map((item) => ({
    group: item.group,
    marker: item.marker,
    ranges: item.ranges.join(', '),
    title: item.title,
    value: item.value,
  })),
);

const circlePackData = [
  {
    children: [
      { name: 'Alpha one', value: 18 },
      { name: 'Alpha two', value: 12 },
    ],
    name: 'Alpha group',
  },
  {
    children: [
      { name: 'Beta one', value: 15 },
      { name: 'Beta two', value: 9 },
    ],
    name: 'Beta group',
  },
] as const;
const circlePackOptions = {
  ...baseChartOptions('Neutral circle pack', 'Neutral circle pack'),
  circlePack: { depth: 2 },
};
const circlePackTable = chartTable(
  'Neutral circle pack hierarchy',
  [
    { key: 'parent', label: 'Parent' },
    { key: 'child', label: 'Child' },
    { key: 'value', label: 'Value' },
  ],
  hierarchyRows(circlePackData),
);

const donutData = [
  { group: 'Alpha', value: 44 },
  { group: 'Beta', value: 31 },
  { group: 'Gamma', value: 25 },
] as const;
const donutOptions = {
  ...baseChartOptions('Neutral donut composition', 'Neutral donut composition'),
  donut: { center: { label: 'Total', number: 100 } },
};
const donutTable = chartTable(
  'Neutral donut chart data',
  [
    { key: 'group', label: 'Segment' },
    { key: 'value', label: 'Value' },
  ],
  donutData,
);

const gaugeData = [
  { group: 'value', value: 64 },
  { group: 'delta', value: 8 },
] as const;
const gaugeOptions = {
  ...baseChartOptions('Neutral gauge', 'Neutral gauge'),
  gauge: { deltaArrow: { enabled: true }, type: 'semi' },
};
const gaugeTable = chartTable(
  'Neutral gauge data',
  [
    { key: 'group', label: 'Measure' },
    { key: 'value', label: 'Value' },
  ],
  gaugeData,
);

const groupedBarData = [
  { group: 'Alpha', key: 'North', value: 24 },
  { group: 'Beta', key: 'North', value: 18 },
  { group: 'Alpha', key: 'South', value: 31 },
  { group: 'Beta', key: 'South', value: 26 },
  { group: 'Alpha', key: 'East', value: 19 },
  { group: 'Beta', key: 'East', value: 22 },
] as const;
const groupedBarOptions = {
  ...baseChartOptions('Neutral grouped bars', 'Neutral grouped bars'),
  axes: {
    bottom: { mapsTo: 'key', scaleType: 'labels' },
    left: { mapsTo: 'value', scaleType: 'linear' },
  },
};
const groupedBarTable = chartTable(
  'Neutral grouped bar data',
  [
    { key: 'key', label: 'Category' },
    { key: 'group', label: 'Series' },
    { key: 'value', label: 'Value' },
  ],
  groupedBarData,
);

const heatmapData = [
  { group: 'Alpha', key: 'January', value: 12 },
  { group: 'Alpha', key: 'February', value: 28 },
  { group: 'Alpha', key: 'March', value: 20 },
  { group: 'Beta', key: 'January', value: 31 },
  { group: 'Beta', key: 'February', value: 18 },
  { group: 'Beta', key: 'March', value: 37 },
] as const;
const heatmapOptions = {
  ...baseChartOptions('Neutral heatmap matrix', 'Neutral heatmap matrix'),
  axes: {
    bottom: { mapsTo: 'key', scaleType: 'labels' },
    left: { mapsTo: 'group', scaleType: 'labels' },
  },
  heatmap: { colorLegend: { title: 'Value' } },
};
const heatmapTable = chartTable(
  'Neutral heatmap data',
  [
    { key: 'group', label: 'Row' },
    { key: 'key', label: 'Column' },
    { key: 'value', label: 'Value' },
  ],
  heatmapData,
);

const lineData = [
  { date: new Date('2025-01-01T00:00:00.000Z'), group: 'Alpha', value: 16 },
  { date: new Date('2025-02-01T00:00:00.000Z'), group: 'Alpha', value: 23 },
  { date: new Date('2025-03-01T00:00:00.000Z'), group: 'Alpha', value: 20 },
  { date: new Date('2025-01-01T00:00:00.000Z'), group: 'Beta', value: 11 },
  { date: new Date('2025-02-01T00:00:00.000Z'), group: 'Beta', value: 18 },
  { date: new Date('2025-03-01T00:00:00.000Z'), group: 'Beta', value: 26 },
] as const;
const lineOptions = {
  ...baseChartOptions('Neutral line trend', 'Neutral line trend'),
  axes: {
    bottom: { mapsTo: 'date', scaleType: 'time' },
    left: { mapsTo: 'value', scaleType: 'linear' },
  },
};
const lineTable = chartTable(
  'Neutral line trend data',
  [
    { key: 'date', label: 'Date' },
    { key: 'group', label: 'Series' },
    { key: 'value', label: 'Value' },
  ],
  dateRows(lineData),
);

const lollipopData = [
  { group: 'Lollipop', key: 'Alpha', value: 14 },
  { group: 'Lollipop', key: 'Beta', value: 26 },
  { group: 'Lollipop', key: 'Gamma', value: 19 },
  { group: 'Lollipop', key: 'Delta', value: 33 },
] as const;
const lollipopOptions = {
  ...baseChartOptions(
    'Neutral lollipop comparison',
    'Neutral lollipop comparison',
  ),
  axes: {
    bottom: { mapsTo: 'key', scaleType: 'labels' },
    left: { mapsTo: 'value', scaleType: 'linear' },
  },
};
const lollipopTable = chartTable(
  'Neutral lollipop chart data',
  [
    { key: 'key', label: 'Category' },
    { key: 'value', label: 'Value' },
  ],
  lollipopData.map(({ key, value }) => ({ key, value })),
);

const meterData = [{ group: 'Current', value: 64 }] as const;
const meterOptions = {
  ...baseChartOptions('Neutral meter', 'Neutral meter'),
  meter: {
    peak: 72,
    status: { ranges: [{ range: [0, 100], status: 'success' }] },
  },
};
const meterTable = chartTable(
  'Neutral meter data',
  [
    { key: 'group', label: 'Measure' },
    { key: 'value', label: 'Value' },
    { key: 'peak', label: 'Peak marker' },
  ],
  [{ group: 'Current', peak: 72, value: 64 }],
);

const pieData = [
  { group: 'North', value: 38 },
  { group: 'South', value: 34 },
  { group: 'East', value: 28 },
] as const;
const pieOptions = {
  ...baseChartOptions('Neutral pie composition', 'Neutral pie composition'),
  pie: { labels: { enabled: true } },
};
const pieTable = chartTable(
  'Neutral pie chart data',
  [
    { key: 'group', label: 'Segment' },
    { key: 'value', label: 'Value' },
  ],
  pieData,
);

const scatterData = [
  { group: 'Alpha', x: 12, y: 18 },
  { group: 'Alpha', x: 28, y: 35 },
  { group: 'Beta', x: 42, y: 26 },
  { group: 'Beta', x: 57, y: 48 },
] as const;
const scatterOptions = {
  ...baseChartOptions(
    'Neutral scatter relationship',
    'Neutral scatter relationship',
  ),
  axes: {
    bottom: { mapsTo: 'x', scaleType: 'linear' },
    left: { mapsTo: 'y', scaleType: 'linear' },
  },
};
const scatterTable = chartTable(
  'Neutral scatter chart data',
  [
    { key: 'group', label: 'Group' },
    { key: 'x', label: 'X value' },
    { key: 'y', label: 'Y value' },
  ],
  scatterData,
);

const simpleBarData = [
  { group: 'North', value: 42 },
  { group: 'South', value: 28 },
  { group: 'East', value: 35 },
  { group: 'West', value: 19 },
] as const;
const simpleBarOptions = {
  ...baseChartOptions('Neutral simple bars', 'Neutral simple bars'),
  axes: {
    bottom: { mapsTo: 'group', scaleType: 'labels' },
    left: { mapsTo: 'value', scaleType: 'linear' },
  },
};
const simpleBarTable = chartTable(
  'Neutral simple bar data',
  [
    { key: 'group', label: 'Category' },
    { key: 'value', label: 'Value' },
  ],
  simpleBarData,
);

const stackedAreaData = [
  { date: new Date('2025-01-01T00:00:00.000Z'), group: 'Alpha', value: 12 },
  { date: new Date('2025-02-01T00:00:00.000Z'), group: 'Alpha', value: 17 },
  { date: new Date('2025-03-01T00:00:00.000Z'), group: 'Alpha', value: 15 },
  { date: new Date('2025-04-01T00:00:00.000Z'), group: 'Alpha', value: 21 },
  { date: new Date('2025-01-01T00:00:00.000Z'), group: 'Beta', value: 8 },
  { date: new Date('2025-02-01T00:00:00.000Z'), group: 'Beta', value: 11 },
  { date: new Date('2025-03-01T00:00:00.000Z'), group: 'Beta', value: 14 },
  { date: new Date('2025-04-01T00:00:00.000Z'), group: 'Beta', value: 10 },
] as const;
const stackedAreaOptions = {
  ...baseChartOptions(
    'Neutral stacked area trend',
    'Neutral stacked area trend',
  ),
  axes: {
    bottom: { mapsTo: 'date', scaleType: 'time' },
    left: { mapsTo: 'value', scaleType: 'linear', stacked: true },
  },
};
const stackedAreaTable = chartTable(
  'Neutral stacked area data',
  [
    { key: 'date', label: 'Date' },
    { key: 'group', label: 'Series' },
    { key: 'value', label: 'Value' },
  ],
  dateRows(stackedAreaData),
);

const stackedBarData = [
  { group: 'Alpha', key: 'North', value: 18 },
  { group: 'Beta', key: 'North', value: 14 },
  { group: 'Alpha', key: 'South', value: 24 },
  { group: 'Beta', key: 'South', value: 11 },
  { group: 'Alpha', key: 'East', value: 17 },
  { group: 'Beta', key: 'East', value: 21 },
] as const;
const stackedBarOptions = {
  ...baseChartOptions('Neutral stacked bars', 'Neutral stacked bars'),
  axes: {
    bottom: { mapsTo: 'key', scaleType: 'labels' },
    left: { mapsTo: 'value', scaleType: 'linear', stacked: true },
  },
};
const stackedBarTable = chartTable(
  'Neutral stacked bar data',
  [
    { key: 'key', label: 'Category' },
    { key: 'group', label: 'Series' },
    { key: 'value', label: 'Value' },
  ],
  stackedBarData,
);

const treemapData = [
  {
    children: [
      { name: 'Alpha one', value: 20 },
      { name: 'Alpha two', value: 14 },
    ],
    name: 'Alpha group',
  },
  {
    children: [
      { name: 'Beta one', value: 17 },
      { name: 'Beta two', value: 11 },
    ],
    name: 'Beta group',
  },
] as const;
const treemapOptions = baseChartOptions(
  'Neutral treemap hierarchy',
  'Neutral treemap hierarchy',
);
const treemapTable = chartTable(
  'Neutral treemap hierarchy',
  [
    { key: 'parent', label: 'Parent' },
    { key: 'child', label: 'Child' },
    { key: 'value', label: 'Value' },
  ],
  hierarchyRows(treemapData),
);

const wordCloudData = [
  { group: 'Alpha', value: 28, word: 'Clarity' },
  { group: 'Alpha', value: 20, word: 'Focus' },
  { group: 'Beta', value: 24, word: 'Context' },
  { group: 'Beta', value: 16, word: 'Signal' },
] as const;
const wordCloudOptions = {
  ...baseChartOptions('Neutral word cloud', 'Neutral word cloud'),
  wordCloud: { fontSizeMapsTo: 'value', wordMapsTo: 'word' },
};
const wordCloudTable = chartTable(
  'Neutral word cloud data',
  [
    { key: 'group', label: 'Group' },
    { key: 'word', label: 'Word' },
    { key: 'value', label: 'Weight' },
  ],
  wordCloudData,
);

export const chartStoryDefinitions = {
  AlluvialChart: {
    Chart: AlluvialChart,
    data: alluvialData,
    marks: [
      { geometry: 'width', minimum: 4, selector: 'path.link' },
      { minimum: 4, selector: 'rect.node' },
    ],
    options: alluvialOptions,
    table: alluvialTable,
  },
  AreaChart: {
    Chart: AreaChart,
    data: areaData,
    marks: [{ minimum: 2, selector: 'path.area' }],
    options: areaOptions,
    table: areaTable,
  },
  BoxplotChart: {
    Chart: BoxplotChart,
    data: boxplotData,
    marks: [
      { minimum: 2, selector: 'path.box' },
      { geometry: 'height', minimum: 2, selector: 'path.whisker.start' },
      { geometry: 'height', minimum: 2, selector: 'path.whisker.end' },
      { geometry: 'height', minimum: 2, selector: 'path.median' },
    ],
    options: boxplotOptions,
    table: boxplotTable,
  },
  BubbleChart: {
    Chart: BubbleChart,
    data: bubbleData,
    marks: [{ minimum: 4, selector: 'circle.dot' }],
    options: bubbleOptions,
    table: bubbleTable,
  },
  BulletChart: {
    Chart: BulletChart,
    data: bulletData,
    marks: [
      { minimum: 6, selector: 'path.range-box' },
      { minimum: 2, selector: 'path.bar' },
      { geometry: 'width', minimum: 2, selector: 'path.marker' },
      { geometry: 'width', minimum: 6, selector: 'path.quartile' },
    ],
    options: bulletOptions,
    table: bulletTable,
  },
  ChoroplethChart: {
    Chart: ChoroplethChart,
    data: geographicData,
    marks: [
      {
        classNameIncludes: 'fill-',
        minimum: 1,
        selector: 'path.border',
      },
    ],
    options: geographicOptions,
    table: geographicTable,
  },
  CirclePackChart: {
    Chart: CirclePackChart,
    data: circlePackData,
    marks: [{ maximum: 4, minimum: 4, selector: 'circle.node-leaf' }],
    options: circlePackOptions,
    table: circlePackTable,
  },
  ComboChart: {
    Chart: ComboChart,
    data: comboData,
    marks: [
      { minimum: 3, selector: 'path.bar' },
      { minimum: 1, selector: 'path.line' },
    ],
    options: comboOptions,
    table: comboTable,
  },
  DonutChart: {
    Chart: DonutChart,
    data: donutData,
    marks: [{ minimum: 3, selector: 'path.slice' }],
    options: donutOptions,
    table: donutTable,
  },
  ExperimentalChoroplethChart: {
    Chart: ExperimentalChoroplethChart,
    data: geographicData,
    marks: [
      {
        classNameIncludes: 'fill-',
        minimum: 1,
        selector: 'path.border',
      },
    ],
    options: geographicOptions,
    table: geographicTable,
  },
  GaugeChart: {
    Chart: GaugeChart,
    data: gaugeData,
    marks: [
      { minimum: 1, selector: 'path.arc-foreground' },
      { minimum: 1, selector: 'text.gauge-value-number', text: '64' },
    ],
    options: gaugeOptions,
    table: gaugeTable,
  },
  GroupedBarChart: {
    Chart: GroupedBarChart,
    data: groupedBarData,
    marks: [{ minimum: 6, selector: 'path.bar' }],
    options: groupedBarOptions,
    table: groupedBarTable,
  },
  HeatmapChart: {
    Chart: HeatmapChart,
    data: heatmapData,
    marks: [
      { minimum: 6, selector: 'rect.heat' },
      { maximum: 0, minimum: 0, selector: 'rect.null-state' },
    ],
    options: heatmapOptions,
    table: heatmapTable,
  },
  HistogramChart: {
    Chart: HistogramChart,
    data: histogramData,
    marks: [{ minimum: 3, selector: 'path.bar' }],
    options: histogramOptions,
    table: histogramTable,
  },
  LineChart: {
    Chart: LineChart,
    data: lineData,
    marks: [{ minimum: 2, selector: 'path.line' }],
    options: lineOptions,
    table: lineTable,
  },
  LollipopChart: {
    Chart: LollipopChart,
    data: lollipopData,
    marks: [
      { minimum: 4, selector: 'circle.dot' },
      { geometry: 'height', minimum: 4, selector: 'line.line' },
    ],
    options: lollipopOptions,
    table: lollipopTable,
  },
  MeterChart: {
    Chart: MeterChart,
    data: meterData,
    marks: [
      { minimum: 1, selector: 'rect.value' },
      { geometry: 'height', minimum: 1, selector: 'line.peak' },
    ],
    options: meterOptions,
    table: meterTable,
  },
  PieChart: {
    Chart: PieChart,
    data: pieData,
    marks: [{ minimum: 3, selector: 'path.slice' }],
    options: pieOptions,
    table: pieTable,
  },
  RadarChart: {
    Chart: RadarChart,
    data: radarData,
    marks: [{ minimum: 2, selector: 'path.blob' }],
    options: radarOptions,
    table: radarTable,
  },
  TimeLineChart: {
    Chart: LineChart,
    data: timeData,
    marks: [{ minimum: 1, selector: 'path.line' }],
    options: timeOptions,
    table: timeTable,
  },
  ScatterChart: {
    Chart: ScatterChart,
    data: scatterData,
    marks: [{ minimum: 4, selector: 'circle.dot' }],
    options: scatterOptions,
    table: scatterTable,
  },
  SimpleBarChart: {
    Chart: SimpleBarChart,
    data: simpleBarData,
    marks: [{ minimum: 4, selector: 'path.bar' }],
    options: simpleBarOptions,
    table: simpleBarTable,
  },
  StackedAreaChart: {
    Chart: StackedAreaChart,
    data: stackedAreaData,
    marks: [{ minimum: 2, selector: 'path.area' }],
    options: stackedAreaOptions,
    table: stackedAreaTable,
  },
  StackedBarChart: {
    Chart: StackedBarChart,
    data: stackedBarData,
    marks: [{ minimum: 6, selector: 'path.bar' }],
    options: stackedBarOptions,
    table: stackedBarTable,
  },
  TreeChart: {
    Chart: TreeChart,
    data: treeData,
    marks: [
      { maximum: 6, minimum: 6, selector: 'g.nodes circle' },
      { geometry: 'width', maximum: 5, minimum: 5, selector: 'g.links path' },
    ],
    options: treeOptions,
    table: treeTable,
  },
  TreemapChart: {
    Chart: TreemapChart,
    data: treemapData,
    marks: [{ minimum: 4, selector: 'rect.leaf' }],
    options: treemapOptions,
    table: treemapTable,
  },
  WordCloudChart: {
    Chart: WordCloudChart,
    data: wordCloudData,
    marks: [{ minimum: 4, selector: 'text.word', text: 'Clarity' }],
    options: wordCloudOptions,
    table: wordCloudTable,
  },
} as const;
