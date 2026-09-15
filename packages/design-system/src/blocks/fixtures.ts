import type { GridColumn, GridRow, PivotConfig, TreeNode } from './types';

// Neutral synthetic data only: datasets, jobs, and infrastructure nodes.
// No customer, employee, company, transaction, or analytics figures.

const STATUSES = ['Ready', 'Importing', 'Failed'] as const;
const FORMATS = ['CSV', 'XLSX', 'Parquet', 'JSON'] as const;
const STEWARDS = ['Platform', 'Ingestion', 'Reporting', 'Governance'] as const;
const REGIONS = ['eu-central', 'eu-west', 'us-east'] as const;

// Status text maps to a Carbon support token so column colors stay themed.
export const statusColorToken: Readonly<Record<string, string>> = {
  Ready: '--cds-support-success',
  Importing: '--cds-support-warning',
  Failed: '--cds-support-error',
};

// Deterministic pseudo values keep fixtures stable across renders and tests.
function pick<T>(values: readonly T[], seed: number): T {
  return values[seed % values.length] as T;
}

export function makeDatasetRows(count: number): GridRow[] {
  return Array.from({ length: count }, (_, index) => {
    const seed = index + 1;
    return {
      id: `dataset-${seed}`,
      name: `dataset_${String(seed).padStart(3, '0')}`,
      steward: pick(STEWARDS, seed),
      region: pick(REGIONS, seed * 2),
      format: pick(FORMATS, seed * 3),
      status: pick(STATUSES, seed * 5),
      rows: (seed * 137) % 90000,
      sizeMb: Number(((seed * 7.3) % 512).toFixed(1)),
      updated: `2026-09-${String(((seed * 3) % 28) + 1).padStart(2, '0')}`,
    };
  });
}

// Columns without visuals; the showcase attaches renderCell and colors on demand.
export const datasetColumns: readonly GridColumn[] = [
  { key: 'name', header: 'Name', sortable: true, pinned: true, width: 220 },
  {
    key: 'steward',
    header: 'Steward',
    sortable: true,
    hideable: true,
    width: 160,
  },
  {
    key: 'region',
    header: 'Region',
    sortable: true,
    hideable: true,
    width: 140,
  },
  {
    key: 'format',
    header: 'Format',
    sortable: true,
    hideable: true,
    width: 120,
  },
  { key: 'status', header: 'Status', sortable: true, width: 140 },
  { key: 'rows', header: 'Rows', sortable: true, align: 'end', width: 120 },
  {
    key: 'sizeMb',
    header: 'Size (MB)',
    sortable: true,
    align: 'end',
    width: 120,
  },
  {
    key: 'updated',
    header: 'Last updated',
    sortable: true,
    hideable: true,
    width: 160,
  },
];

// A small ingestion-job set used for compact demos.
export const jobRows: readonly GridRow[] = [
  {
    id: 'job-1',
    name: 'nightly_import',
    status: 'Ready',
    duration: 42,
    region: 'eu-central',
  },
  {
    id: 'job-2',
    name: 'schema_scan',
    status: 'Importing',
    duration: 8,
    region: 'eu-west',
  },
  {
    id: 'job-3',
    name: 'backfill_2026',
    status: 'Failed',
    duration: 190,
    region: 'us-east',
  },
  {
    id: 'job-4',
    name: 'compaction',
    status: 'Ready',
    duration: 27,
    region: 'eu-central',
  },
];

export const jobColumns: readonly GridColumn[] = [
  { key: 'name', header: 'Job', sortable: true },
  { key: 'status', header: 'Status', sortable: true },
  { key: 'region', header: 'Region', sortable: true },
  { key: 'duration', header: 'Duration (s)', sortable: true, align: 'end' },
];

// An infrastructure tree: regions contain clusters contain nodes.
export const infrastructureTree: readonly TreeNode[] = [
  {
    id: 'eu-central',
    cells: {
      name: 'eu-central',
      kind: 'Region',
      status: 'Ready',
      capacity: 100,
    },
    children: [
      {
        id: 'eu-central-a',
        cells: {
          name: 'cluster-a',
          kind: 'Cluster',
          status: 'Ready',
          capacity: 60,
        },
        children: [
          {
            id: 'node-a1',
            cells: {
              name: 'node-a1',
              kind: 'Node',
              status: 'Ready',
              capacity: 30,
            },
          },
          {
            id: 'node-a2',
            cells: {
              name: 'node-a2',
              kind: 'Node',
              status: 'Importing',
              capacity: 30,
            },
          },
        ],
      },
      {
        id: 'eu-central-b',
        cells: {
          name: 'cluster-b',
          kind: 'Cluster',
          status: 'Ready',
          capacity: 40,
        },
        children: [
          {
            id: 'node-b1',
            cells: {
              name: 'node-b1',
              kind: 'Node',
              status: 'Ready',
              capacity: 40,
            },
          },
        ],
      },
    ],
  },
  {
    id: 'us-east',
    cells: { name: 'us-east', kind: 'Region', status: 'Failed', capacity: 80 },
    children: [
      {
        id: 'us-east-a',
        cells: {
          name: 'cluster-a',
          kind: 'Cluster',
          status: 'Failed',
          capacity: 80,
        },
        children: [
          {
            id: 'node-c1',
            cells: {
              name: 'node-c1',
              kind: 'Node',
              status: 'Failed',
              capacity: 80,
            },
          },
        ],
      },
    ],
  },
];

export const treeColumns: readonly GridColumn[] = [
  { key: 'name', header: 'Name' },
  { key: 'kind', header: 'Kind' },
  { key: 'status', header: 'Status' },
  { key: 'capacity', header: 'Capacity', align: 'end' },
];

// Pivot source: dataset size and row count by steward and status.
export const pivotConfig: PivotConfig = {
  rowDimension: 'steward',
  columnDimension: 'status',
  measures: [
    { key: 'sizeMb', label: 'Size (MB)', aggregation: 'sum' },
    { key: 'rows', label: 'Rows', aggregation: 'sum' },
  ],
};
