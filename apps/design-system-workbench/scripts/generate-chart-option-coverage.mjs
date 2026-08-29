import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { format, resolveConfig } from 'prettier';

const root = resolve(import.meta.dirname, '..');
const catalog = JSON.parse(
  await readFile(
    resolve(root, '../../packages/design-system/src/catalog.generated.json'),
    'utf8',
  ),
);
const output = resolve(root, 'src/charts/chart-option-coverage.json');
const existing = await readFile(output, 'utf8').catch(() => null);

const bindings = {
  AlluvialChartOptions: { chart: 'AlluvialChart', path: [] },
  AreaChartOptions: { chart: 'AreaChart', path: [] },
  AxisChartOptions: { chart: 'AreaChart', path: [] },
  AxisOptions: { chart: 'TimeLineChart', path: ['axes', 'bottom'] },
  BarChartOptions: { chart: 'GroupedBarChart', path: [] },
  BarOptions: { chart: 'GroupedBarChart', path: ['bars'] },
  BaseChartOptions: { chart: 'AreaChart', path: [] },
  BasedAxisOptions: { chart: 'TimeLineChart', path: ['axes', 'bottom'] },
  BinnedAxisChartOptions: { chart: 'HistogramChart', path: [] },
  BinnedAxisOptions: { chart: 'HistogramChart', path: ['axes', 'bottom'] },
  BoxplotChartOptions: { chart: 'BoxplotChart', path: [] },
  BubbleChartOptions: { chart: 'BubbleChart', path: [] },
  BulletChartOptions: { chart: 'BulletChart', path: [] },
  ChartOptions: { chart: 'AreaChart', path: [] },
  ChoroplethChartOptions: { chart: 'ChoroplethChart', path: [] },
  CirclePackChartOptions: { chart: 'CirclePackChart', path: [] },
  ComboChartAxisOptions: { chart: 'TimeLineChart', path: ['axes', 'bottom'] },
  ComboChartOptions: { chart: 'ComboChart', path: [] },
  DonutChartOptions: { chart: 'DonutChart', path: [] },
  GaugeChartOptions: { chart: 'GaugeChart', path: [] },
  HeatmapChartOptions: { chart: 'HeatmapChart', path: [] },
  HistogramChartOptions: { chart: 'HistogramChart', path: [] },
  LegendOptions: { chart: 'AreaChart', path: ['legend'] },
  LineChartOptions: { chart: 'LineChart', path: [] },
  LollipopChartOptions: { chart: 'LollipopChart', path: [] },
  MeterChartOptions: { chart: 'MeterChart', path: [] },
  PieChartOptions: { chart: 'PieChart', path: [] },
  ProportionalMeterChartOptions: { chart: 'MeterChart', path: [] },
  RadarChartOptions: { chart: 'RadarChart', path: [] },
  ScatterChartOptions: { chart: 'ScatterChart', path: [] },
  StackedAreaChartOptions: { chart: 'StackedAreaChart', path: [] },
  StackedBarChartOptions: { chart: 'StackedBarChart', path: [] },
  StackedBarOptions: { chart: 'StackedBarChart', path: ['bars'] },
  ThematicChartOptions: { chart: 'ChoroplethChart', path: [] },
  TimeScaleOptions: { chart: 'TimeLineChart', path: ['timeScale'] },
  ToolbarOptions: { chart: 'AreaChart', path: ['toolbar'] },
  TooltipOptions: { chart: 'AreaChart', path: ['tooltip'] },
  TreeChartOptions: { chart: 'TreeChart', path: [] },
  TreemapChartOptions: { chart: 'TreemapChart', path: [] },
  WordCloudChartOptions: { chart: 'WordCloudChart', path: [] },
  WordCloudChartTooltipOptions: { chart: 'WordCloudChart', path: ['tooltip'] },
  WorldCloudChartOptions: { chart: 'WordCloudChart', path: [] },
  ZoomBarOptions: { chart: 'TimeLineChart', path: ['zoomBar', 'top'] },
  ZoomBarsOptions: { chart: 'TimeLineChart', path: ['zoomBar'] },
};
const excluded = {
  RulerOptions:
    'Pinned Carbon Charts 1.27.18 exports this internal option from interfaces/components.d.ts, but no public *ChartOptions field references RulerOptions.',
  getSVGElementSizeOptions:
    'Pinned Carbon Charts 1.27.18 exports this DOM measurement helper without a React chart configuration path.',
};
const topLevelProperties = new Set(['animations', 'experimental', 'resizable']);
const declarations = catalog.inventories.charts.declarations['@carbon/charts'];
const records = [];

for (const declaration of declarations) {
  if (
    !declaration.typeOnly ||
    !declaration.name.endsWith('Options') ||
    !Array.isArray(declaration.properties)
  ) {
    continue;
  }
  const binding = bindings[declaration.name];
  const exclusion = excluded[declaration.name];
  const literalProperties = declaration.properties.filter(
    (property) => property.values?.length,
  );
  if (!literalProperties.length) continue;
  if (!binding && !exclusion) {
    throw new Error(`Missing chart option binding for ${declaration.name}.`);
  }
  for (const property of literalProperties) {
    for (const [index, value] of (property.values ?? []).entries()) {
      const id = `api-${declaration.name}-${property.name}-${index}`
        .replaceAll(/[^a-zA-Z0-9-]+/g, '-')
        .toLowerCase();
      const path = binding
        ? [
            ...(topLevelProperties.has(property.name) ? [] : binding.path),
            property.name,
          ]
        : null;
      records.push({
        aliasOf: declaration.aliasOf,
        chart: binding?.chart ?? null,
        declaration: declaration.name,
        executionStatus: binding ? 'covered' : 'excluded',
        id,
        localTarget: binding
          ? `storybook:charts-standard-charts--all-options#${id}`
          : null,
        path,
        property: property.name,
        reason: binding
          ? declaration.aliasOf
            ? `Deprecated ${declaration.name} alias mounted with its canonical ${binding.chart} fixture.`
            : `Pinned Carbon Charts 1.27.18 literal mounted individually with neutral ${binding.chart} data.`
          : exclusion,
        value,
      });
    }
  }
}

records.sort((left, right) => left.id.localeCompare(right.id));
const content = await format(JSON.stringify(records, null, 2), {
  ...((await resolveConfig(output)) ?? {}),
  filepath: output,
});
if (process.argv.includes('--check')) {
  if (existing !== content) {
    throw new Error(
      'Chart option coverage is out of date. Run chart:coverage.',
    );
  }
} else if (existing !== content) {
  await writeFile(output, content);
}
console.log(`Chart option coverage verified: ${records.length} literals.`);
