# Data Visualization, Charts, and Diagrams

> Modified BAP guidance. Sources: Carbon website data-visualization pages at
> commit `df723531e56036f90bac8b1bbec7a0414a285063`, Carbon Charts documentation
> and source at tag `v1.27.18`, commit
> `abd30134f12462c9215a823543fdda56779719e6`. This chapter is original BAP prose
> and uses neutral fixtures.

## Start with the question

A visualization must answer a defined question. First identify the comparison,
trend, distribution, relationship, hierarchy, flow, or spatial pattern. Then
choose a chart. If precise values or text scanning are primary, use a table.

Every chart needs:

- a descriptive visible title;
- units and meaningful axis or value labels;
- a stable mapping from data to marks;
- an accessible SVG label;
- a complete localized table equivalent;
- explicit missing, loading, empty, and error states.

## Chart anatomy

The chart container owns size and theme. The title and optional description
establish purpose. Plot area, axes, scales, marks, grid lines, thresholds,
annotations, legend, tooltip, toolbar, and zoom controls support the question.
Remove elements that do not add meaning, but never remove context required to
interpret the values.

`ChartFrame` owns the shared title and table structure in BAP. The caller owns
valid data, options, localization, and missing-value semantics.

## Chart selection

### Comparison and trend

| Chart              | Use                                                                                    |
| ------------------ | -------------------------------------------------------------------------------------- |
| `SimpleBarChart`   | Compare values across categories. Orientation is configured through axes.              |
| `GroupedBarChart`  | Compare a small number of series inside categories.                                    |
| `StackedBarChart`  | Compare totals and contributions when stacking remains legible.                        |
| `LollipopChart`    | Lighter category comparison when exact area is not the message.                        |
| `LineChart`        | Trend across an ordered or time scale.                                                 |
| `AreaChart`        | Trend with magnitude emphasized against a baseline.                                    |
| `StackedAreaChart` | Change in total and contribution over an ordered scale.                                |
| `ComboChart`       | Related series need compatible mark types and axes. Avoid unrelated dual-axis stories. |

### Distribution and correlation

| Chart            | Use                                                                      |
| ---------------- | ------------------------------------------------------------------------ |
| `HistogramChart` | Distribution of values in meaningful bins.                               |
| `BoxplotChart`   | Compare distribution summaries and outliers.                             |
| `ScatterChart`   | Relationship between two quantitative variables.                         |
| `BubbleChart`    | Scatter relationship with a meaningful third-size variable.              |
| `HeatmapChart`   | Magnitude across two categorical or binned dimensions.                   |
| `RadarChart`     | Compare a small number of similarly scaled profiles; avoid crowded axes. |

### Part to whole and progress

| Chart             | Use                                                                          |
| ----------------- | ---------------------------------------------------------------------------- |
| `PieChart`        | A few unmistakable parts of one whole. Prefer direct labels.                 |
| `DonutChart`      | Part-to-whole with a central summary.                                        |
| `TreemapChart`    | Hierarchical part-to-whole when area comparison is sufficient.               |
| `CirclePackChart` | Hierarchical grouping when containment matters more than precise comparison. |
| `MeterChart`      | Compact progress or capacity against a known range.                          |
| `GaugeChart`      | Current position in a meaningful qualitative range.                          |
| `BulletChart`     | Actual value against target and qualitative ranges.                          |

### Hierarchy, flow, text, and spatial

| Chart             | Use                                                                    |
| ----------------- | ---------------------------------------------------------------------- |
| `TreeChart`       | Parent-child hierarchy.                                                |
| `AlluvialChart`   | Magnitude moving among stages or categories.                           |
| `WordCloudChart`  | Rough prominence of terms only; provide a sorted table for comparison. |
| `ChoroplethChart` | Value encoded by geographic region with valid geographic context.      |

The React package has 25 chart component exports. The Carbon Charts site calls
the offering a library of 26 because network diagrams are counted as an
additional offering. `ExperimentalChoroplethChart` is a deprecated alias for
`ChoroplethChart`.

## Axes, scales, and labels

Use a categorical labels scale for unordered groups, linear or logarithmic
scales for quantitative domains, and time scales for dates. Start bars and
part-to-whole comparisons at zero. A truncated quantitative domain must be
visibly justified and must not exaggerate change.

Give each axis a title and units unless the context is unambiguous. Format ticks
consistently and preserve the unformatted value in the table. Rotate or truncate
labels only after wrapping, spacing, orientation, or chart choice is considered.

## Legends and direct labels

Direct labels are preferable when they fit. A legend must use the same order,
name, color, and symbol as the marks and remain operable at zoom. Do not rely on
color alone. Keep series mapping stable across related charts and filtered
states.

## Color palettes

Use Carbon chart palettes and theme support. Sequential palettes encode ordered
magnitude, diverging palettes encode distance from a meaningful midpoint, and
categorical palettes distinguish groups. Do not imply order with a categorical
palette or status with arbitrary hue.

All chart types support `white`, `g10`, `g90`, and `g100`. Test tooltips,
thresholds, focus, grid lines, and legends in each theme.

The workbench exposes common safe chart controls for theme, animation, legend,
toolbar, height, and resizability. These controls merge with each chart's
pinned, family-specific options; they do not invent application data or replace
the generated options explorer.

## Tooltips and interaction

Tooltips supplement visible context and must not be the sole route to a value.
Format values and dates by locale. Keep pointer and keyboard interaction
consistent. Avoid trapping focus in transient content.

Use highlights, thresholds, and annotations to answer a known question. Do not
decorate a chart with arbitrary reference lines. Toolbar controls, zoom bars,
and event listeners need accessible names, visible state, reset behavior, and a
defined effect on the table equivalent.

## Options model

Every React chart accepts `data: ChartTabularData` and a chart-specific options
type. Common option groups include:

- title, dimensions, resizability, and theme;
- axes, scale types, domains, ticks, and time locale;
- legend position and additional items;
- tooltip formatting and truncation;
- color scale and gradients;
- accessibility labels and tabular-data customization;
- toolbar controls, zoom bars, thresholds, ruler, and grid;
- chart-specific curves, stacking, grouping, gauge, meter, hierarchy, map, or
  word layout;
- event types for chart, model, axes, marks, legend, tooltip, toolbar, zoom,
  threshold, and modal behavior.

The generated options explorer is the exhaustive source for the pinned types. Do
not copy a large default-options object into application code.

The workbench generates 292 finite literals from all 46 public `*Options`
declarations, including deprecated aliases. It mounts each executable literal
one at a time with a compatible neutral chart and records a deep link. Ten
literals from `RulerOptions` and `getSVGElementSizeOptions` remain explicitly
excluded because the pinned declarations expose no public React chart-options
path for them. Recheck these reviewed exclusions when Carbon Charts changes.

## Pinned chart accessibility exceptions

The standard-chart stories run axe with errors enabled. Three narrow exceptions
are documented in the corresponding story parameters for pinned Carbon Charts
1.27.18 internals: Alluvial and Heatmap add prohibited ARIA attributes to graph
SVG elements, and Gauge renders an internal SVG image without its own accessible
name. Each specimen still has a labeled outer chart and mandatory equivalent
table. Do not copy these exceptions to product charts; reassess them when the
pinned chart package changes.

## Neutral chart example

```tsx
'use client';

import {
  ChartFrame,
  ScaleTypes,
  SimpleBarChart,
  type BarChartOptions,
} from '@bap/design-system/charts';

const data = [
  { group: 'Group A', value: 24 },
  { group: 'Group B', value: 40 },
];

const options: BarChartOptions = {
  accessibility: { svgAriaLabel: 'Two neutral example values' },
  axes: {
    bottom: { mapsTo: 'group', scaleType: ScaleTypes.LABELS },
    left: { mapsTo: 'value' },
  },
  height: '320px',
  title: 'Neutral comparison',
};

const table = {
  columns: [
    { key: 'group', label: 'Group' },
    { key: 'value', label: 'Value' },
  ],
  label: 'Neutral comparison values',
  rows: data.map((item) => ({
    id: item.group,
    values: item,
  })),
};

export function NeutralChart() {
  return (
    <ChartFrame table={table} title="Neutral comparison">
      <SimpleBarChart data={data} options={options} />
    </ChartFrame>
  );
}
```

The example demonstrates structure only. It carries no business meaning.

## Dashboard guidance

A dashboard is a coordinated decision surface, not a grid of unrelated charts.
Define audience, decisions, refresh time, comparison periods, units, filters,
empty states, and drill paths. Preserve consistent series naming and layout.
Because no BAP dashboard requirements exist here, the workbench demonstrates
layout mechanics only and does not create a product dashboard.

## Flow and Gantt guidance

The website documents flow and Gantt considerations beyond the installed
standard chart components. Do not imply an installed React chart exists when it
does not. Use network-diagram primitives for supported graph structures. A Gantt
implementation requires a separately approved accessible component or custom
product work and remains documentation-only.

## Network diagrams

React diagram exports are:

- `CardNode`, `CardNodeColumn`, `CardNodeTitle`, `CardNodeSubtitle`, and
  `CardNodeLabel`;
- `ShapeNode`;
- `Edge`;
- `Marker`, `ArrowLeftMarker`, `ArrowRightMarker`, `CircleMarker`,
  `DiamondMarker`, `SquareMarker`, and `TeeMarker`.

CardNode supports `div`, `a`, or `button`, optional stacked layout, color, and
position. ShapeNode supports circle, square, and rounded-square shapes plus
link, button, or static behavior. Edge supports straight or supplied paths,
source and target coordinates, markers, color, and documented dash, double, or
tunnel variants.

An SVG network diagram needs a textual equivalent that lists nodes and
connections in a meaningful order. Spatial position, marker shape, or color
cannot be the sole carrier of relationship meaning.

## Localization and accessibility

- Format dates, numbers, percentages, units, and missing values by locale.
- Keep raw values in an equivalent table.
- Give the SVG an accessible label and avoid duplicate announcements.
- Use shapes, patterns, labels, or position in addition to color.
- Ensure focusable marks and controls have visible focus.
- Honor `prefers-reduced-motion` in applications. The workbench motion toolbar
  provides a deterministic reduced preview only; it does not replace that app
  responsibility.
- Test narrow viewports, 200% and 400% zoom, keyboard operation, and screen
  reader output.

Small circular slices and dense marks can be difficult to reach or identify. The
equivalent table is mandatory even when the chart library exposes tooltips.
