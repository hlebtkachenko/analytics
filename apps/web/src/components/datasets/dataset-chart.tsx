'use client';

import { ChartFrame } from '@bap/design-system/charts';
import { InlineNotification, Section } from '@bap/design-system/react';
import { useTranslation } from 'react-i18next';

import type { DatasetColumn, DatasetRow } from '../../lib/datasets/client';

type DatasetChartProps = Readonly<{
  columns: readonly DatasetColumn[];
  rows: readonly DatasetRow[];
}>;

// A readable slice of one page, drawn without a chart library.
const MAX_BARS = 12;
const BAR_HEIGHT = 16;
const BAR_GAP = 8;
const CHART_WIDTH = 100;

// A CSV cell arrives as text, so a column inferred as number is parsed rather than assumed.
// inferredType is a parser hint about the column, never a guarantee about one value.
function toNumber(value: unknown): number | undefined {
  const parsed =
    typeof value === 'string' && value.trim() !== ''
      ? Number(value.trim())
      : value;

  return typeof parsed === 'number' && Number.isFinite(parsed)
    ? parsed
    : undefined;
}

export function DatasetChart({ columns, rows }: DatasetChartProps) {
  const { t } = useTranslation();
  const measure = columns.find((column) => column.inferredType === 'number');
  const category = columns.find((column) => column.inferredType !== 'number');
  const points = rows.slice(0, MAX_BARS).flatMap((row) => {
    const value =
      measure === undefined ? undefined : toNumber(row.data[measure.name]);

    if (value === undefined) {
      return [];
    }

    const label = category === undefined ? undefined : row.data[category.name];

    return [
      {
        id: String(row.rowNumber),
        label:
          label === null || label === undefined
            ? String(row.rowNumber)
            : String(label),
        value,
      },
    ];
  });

  if (measure === undefined || points.length === 0) {
    return (
      <InlineNotification
        kind="info"
        lowContrast
        title={t('datasets.chartUnavailable')}
      />
    );
  }

  const largest = Math.max(...points.map((point) => Math.abs(point.value)));
  const scale = largest === 0 ? 0 : CHART_WIDTH / largest;
  const height = points.length * (BAR_HEIGHT + BAR_GAP);

  return (
    <Section>
      <ChartFrame
        description={t('datasets.chartDescription')}
        missingValueLabel={t('datasets.chartMissingValue')}
        table={{
          columns: [
            {
              key: 'category',
              label: category?.name ?? t('datasets.rowNumber'),
            },
            { key: 'value', label: measure.name },
          ],
          description: t('datasets.chartTableDescription'),
          label: t('datasets.chartTableLabel'),
          rows: points.map((point) => ({
            id: point.id,
            values: { category: point.label, value: point.value },
          })),
        }}
        title={t('datasets.chartTitle')}
      >
        <svg
          aria-label={t('datasets.chartGraphic')}
          height={height}
          preserveAspectRatio="none"
          role="img"
          viewBox={`0 0 ${CHART_WIDTH} ${height}`}
          width="100%"
        >
          {points.map((point, index) => (
            <rect
              fill="currentColor"
              height={BAR_HEIGHT}
              key={point.id}
              width={Math.abs(point.value) * scale}
              x={0}
              y={index * (BAR_HEIGHT + BAR_GAP)}
            />
          ))}
        </svg>
      </ChartFrame>
    </Section>
  );
}
