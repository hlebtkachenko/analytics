'use client';

import {
  DataGrid,
  PivotGrid,
  TreeDataGrid,
  type BatchAction,
  type DataGridProps,
  type DensitySize,
  type GridColumn,
  type GridRow,
  type GridState,
  type LoadingMode,
  type SelectionMode,
} from '@bap/design-system/blocks';
import {
  datasetColumns,
  infrastructureTree,
  makeDatasetRows,
  pivotConfig,
  treeColumns,
} from '@bap/design-system/blocks/fixtures';
import {
  Column,
  Dropdown,
  Grid,
  Heading,
  NumberInput,
  RadioButton,
  RadioButtonGroup,
  Section,
  Stack,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Tabs,
  Tag,
  Tile,
  Toggle,
} from '@bap/design-system/react';
import { useCallback, useMemo, useState, type ReactNode } from 'react';

import PageContainer from '../page-container';
import styles from './tables-showcase.module.scss';

const DENSITIES: readonly DensitySize[] = ['xs', 'sm', 'md', 'lg', 'xl'];
const TOTAL_ROWS = 60;
const PAGE_STEP = 20;

// Map a dataset status to a themed Carbon tag color.
const statusTagType: Record<string, 'green' | 'blue' | 'red' | 'gray'> = {
  Ready: 'green',
  Importing: 'blue',
  Failed: 'red',
};

// Feature switches that drive the live grid.
type Flags = {
  zebra: boolean;
  wrapCells: boolean;
  sortable: boolean;
  multiSort: boolean;
  lockSort: boolean;
  search: boolean;
  pagination: boolean;
  rowNumbers: boolean;
  clickable: boolean;
  stickyHeader: boolean;
  scroll: boolean;
  virtualized: boolean;
  infinite: boolean;
  cellSelection: boolean;
  resizableColumns: boolean;
  reorderableColumns: boolean;
  reorderableRows: boolean;
  columnMenu: boolean;
  totals: boolean;
  footer: boolean;
  perRowVisuals: boolean;
  columnColors: boolean;
  batch: boolean;
  persist: boolean;
};

const TOGGLES: readonly { key: keyof Flags; label: string }[] = [
  { key: 'sortable', label: 'Sortable' },
  { key: 'multiSort', label: 'Multi column sort' },
  { key: 'lockSort', label: 'Fixed sort' },
  { key: 'search', label: 'Search' },
  { key: 'pagination', label: 'Pagination' },
  { key: 'rowNumbers', label: 'Row numbers' },
  { key: 'clickable', label: 'Clickable rows' },
  { key: 'zebra', label: 'Zebra rows' },
  { key: 'wrapCells', label: 'Wrap cells' },
  { key: 'stickyHeader', label: 'Sticky header' },
  { key: 'scroll', label: 'Scroll region' },
  { key: 'virtualized', label: 'Virtualized' },
  { key: 'infinite', label: 'Infinite scroll' },
  { key: 'cellSelection', label: 'Cell selection' },
  { key: 'resizableColumns', label: 'Resizable columns' },
  { key: 'reorderableColumns', label: 'Reorder columns' },
  { key: 'reorderableRows', label: 'Reorder rows' },
  { key: 'columnMenu', label: 'Column menu' },
  { key: 'totals', label: 'Totals row' },
  { key: 'footer', label: 'Footer slot' },
  { key: 'perRowVisuals', label: 'Per row visuals' },
  { key: 'columnColors', label: 'Column colors' },
  { key: 'batch', label: 'Bulk actions' },
  { key: 'persist', label: 'Persist layout' },
];

const DEFAULT_FLAGS: Flags = {
  zebra: false,
  wrapCells: false,
  sortable: true,
  multiSort: false,
  lockSort: false,
  search: true,
  pagination: true,
  rowNumbers: true,
  clickable: false,
  stickyHeader: false,
  scroll: false,
  virtualized: false,
  infinite: false,
  cellSelection: false,
  resizableColumns: false,
  reorderableColumns: false,
  reorderableRows: false,
  columnMenu: false,
  totals: false,
  footer: false,
  perRowVisuals: true,
  columnColors: false,
  batch: false,
  persist: false,
};

export function TablesShowcase() {
  const [flags, setFlags] = useState<Flags>(DEFAULT_FLAGS);
  const [density, setDensity] = useState<DensitySize>('sm');
  const [selection, setSelection] = useState<SelectionMode>('none');
  const [asyncState, setAsyncState] = useState<GridState>('ready');
  const [loadingMode, setLoadingMode] = useState<LoadingMode>('skeleton');
  const [maxHeight, setMaxHeight] = useState(320);
  const [pageSize, setPageSize] = useState(10);
  const [loaded, setLoaded] = useState(PAGE_STEP);

  // Side panel state fed by grid interactions.
  const [selectedCount, setSelectedCount] = useState(0);
  const [lastRow, setLastRow] = useState('none');
  const [lastAction, setLastAction] = useState('none');

  const allRows = useMemo(() => makeDatasetRows(TOTAL_ROWS), []);
  const gridRows = flags.infinite ? allRows.slice(0, loaded) : allRows;
  const hasMore = flags.infinite && loaded < allRows.length;

  const setFlag = (key: keyof Flags) => (checked: boolean) =>
    setFlags((current) => ({ ...current, [key]: checked }));

  // Attach per-column visuals and colors when their toggles are on.
  const columns = useMemo<readonly GridColumn[]>(
    () =>
      datasetColumns.map((column) => {
        if (column.key === 'status' && flags.perRowVisuals) {
          return {
            ...column,
            renderCell: (row: GridRow) => (
              <Tag size="sm" type={statusTagType[String(row.status)] ?? 'gray'}>
                {String(row.status)}
              </Tag>
            ),
          };
        }
        if (column.key === 'sizeMb' && flags.columnColors) {
          return { ...column, colorToken: '--cds-text-secondary' };
        }
        return column;
      }),
    [flags.perRowVisuals, flags.columnColors],
  );

  const totalsRow = useMemo(
    () => ({
      name: 'Total',
      rows: gridRows.reduce((sum, row) => sum + Number(row.rows ?? 0), 0),
      sizeMb: Number(
        gridRows
          .reduce((sum, row) => sum + Number(row.sizeMb ?? 0), 0)
          .toFixed(1),
      ),
    }),
    [gridRows],
  );

  const onLoadMore = useCallback(
    () => setLoaded((current) => Math.min(current + PAGE_STEP, TOTAL_ROWS)),
    [],
  );
  const onRowClick = useCallback(
    (row: GridRow) => setLastRow(String(row.name)),
    [],
  );
  const onSelectionChange = useCallback(
    (ids: readonly string[]) => setSelectedCount(ids.length),
    [],
  );
  const batchActions = useMemo<readonly BatchAction[]>(
    () => [
      {
        id: 'export',
        label: 'Export',
        onClick: (ids) => setLastAction(`Export ${ids.length}`),
      },
      {
        id: 'archive',
        label: 'Archive',
        onClick: (ids) => setLastAction(`Archive ${ids.length}`),
      },
    ],
    [],
  );

  // Assemble grid props, spreading optional entries so none is ever undefined.
  const gridProps: DataGridProps = {
    columns,
    rows: gridRows,
    title: 'Datasets',
    description: 'Synthetic dataset inventory for the table component blocks.',
    size: density,
    zebra: flags.zebra,
    wrapCells: flags.wrapCells,
    sortable: flags.sortable,
    multiSort: flags.multiSort,
    lockSort: flags.lockSort,
    selection,
    search: flags.search,
    pagination: flags.pagination,
    pageSize,
    rowNumbers: flags.rowNumbers,
    columnMenu: flags.columnMenu,
    resizableColumns: flags.resizableColumns,
    reorderableColumns: flags.reorderableColumns,
    stickyHeader: flags.stickyHeader,
    virtualized: flags.virtualized,
    cellSelection: flags.cellSelection,
    state: asyncState,
    loadingMode,
    onSelectionChange,
    ...(flags.persist ? { persistKey: 'tables-showcase' } : {}),
    ...(flags.totals ? { totalsRow } : {}),
    ...(flags.footer ? { footer: <Footer count={gridRows.length} /> } : {}),
    ...(flags.clickable ? { onRowClick } : {}),
    ...(flags.batch ? { batchActions } : {}),
    ...(flags.scroll || flags.virtualized ? { maxHeight } : {}),
    ...(flags.infinite ? { infiniteScroll: true, hasMore, onLoadMore } : {}),
    ...(flags.reorderableRows ? { reorderableRows: true } : {}),
  };

  return (
    <main aria-labelledby="tables-showcase-heading">
      <PageContainer>
        <header>
          <Heading id="tables-showcase-heading">Table component blocks</Heading>
          <p>
            Carbon table archetypes mapped from the cube data table variations.
            One toggle-driven grid, a tree grid, and a pivot grid.
          </p>
          <Stack gap={3} orientation="horizontal">
            <Tag type="green">DataGrid</Tag>
            <Tag type="blue">TreeDataGrid</Tag>
            <Tag type="purple">PivotGrid</Tag>
          </Stack>
        </header>

        <Tabs>
          <TabList aria-label="Table archetypes">
            <Tab>Data grid</Tab>
            <Tab>Tree</Tab>
            <Tab>Pivot</Tab>
          </TabList>
          <TabPanels>
            <TabPanel>
              <Grid className={styles.panelGrid ?? ''}>
                <Column lg={4} md={8} sm={4}>
                  <Section level={2}>
                    <Tile>
                      <Stack gap={5}>
                        <Heading>Controls</Heading>
                        <Dropdown
                          id="density"
                          items={[...DENSITIES]}
                          itemToString={(item) => item ?? ''}
                          label="Density"
                          onChange={(data) => {
                            if (data.selectedItem)
                              setDensity(data.selectedItem);
                          }}
                          selectedItem={density}
                          titleText="Density"
                        />
                        <RadioButtonGroup
                          legendText="Selection"
                          name="selection"
                          onChange={(value) =>
                            setSelection(value as SelectionMode)
                          }
                          valueSelected={selection}
                        >
                          <RadioButton
                            id="sel-none"
                            labelText="None"
                            value="none"
                          />
                          <RadioButton
                            id="sel-single"
                            labelText="Single"
                            value="single"
                          />
                          <RadioButton
                            id="sel-multi"
                            labelText="Multi"
                            value="multi"
                          />
                        </RadioButtonGroup>
                        <RadioButtonGroup
                          legendText="State"
                          name="state"
                          onChange={(value) =>
                            setAsyncState(value as GridState)
                          }
                          valueSelected={asyncState}
                        >
                          <RadioButton
                            id="state-ready"
                            labelText="Ready"
                            value="ready"
                          />
                          <RadioButton
                            id="state-loading"
                            labelText="Loading"
                            value="loading"
                          />
                          <RadioButton
                            id="state-empty"
                            labelText="Empty"
                            value="empty"
                          />
                          <RadioButton
                            id="state-error"
                            labelText="Error"
                            value="error"
                          />
                        </RadioButtonGroup>
                        <RadioButtonGroup
                          legendText="Loading mode"
                          name="loading-mode"
                          onChange={(value) =>
                            setLoadingMode(value as LoadingMode)
                          }
                          valueSelected={loadingMode}
                        >
                          <RadioButton
                            id="load-skeleton"
                            labelText="Skeleton"
                            value="skeleton"
                          />
                          <RadioButton
                            id="load-overlay"
                            labelText="Overlay"
                            value="overlay"
                          />
                        </RadioButtonGroup>
                        <NumberInput
                          id="page-size"
                          label="Page size"
                          min={1}
                          onChange={(_event, { value }) => {
                            const next = Number(value);
                            if (!Number.isNaN(next)) setPageSize(next);
                          }}
                          value={pageSize}
                        />
                        <NumberInput
                          id="max-height"
                          label="Scroll height (px)"
                          min={120}
                          onChange={(_event, { value }) => {
                            const next = Number(value);
                            if (!Number.isNaN(next)) setMaxHeight(next);
                          }}
                          value={maxHeight}
                        />
                        <div className={styles.toggles}>
                          {TOGGLES.map((toggle) => (
                            <Toggle
                              id={`toggle-${toggle.key}`}
                              key={toggle.key}
                              labelA="Off"
                              labelB="On"
                              labelText={toggle.label}
                              onToggle={setFlag(toggle.key)}
                              size="sm"
                              toggled={flags[toggle.key]}
                            />
                          ))}
                        </div>
                      </Stack>
                    </Tile>
                  </Section>
                </Column>
                <Column lg={8} md={8} sm={4}>
                  <DataGrid {...gridProps} />
                </Column>
                <Column lg={4} md={8} sm={4}>
                  <Section level={2}>
                    <Tile>
                      <Stack gap={5}>
                        <Heading>Details</Heading>
                        <Detail
                          label="Selected rows"
                          value={String(selectedCount)}
                        />
                        <Detail label="Last clicked row" value={lastRow} />
                        <Detail label="Last bulk action" value={lastAction} />
                        <Detail
                          label="Loaded rows"
                          value={String(gridRows.length)}
                        />
                      </Stack>
                    </Tile>
                  </Section>
                </Column>
              </Grid>
            </TabPanel>

            <TabPanel>
              <Grid>
                <Column lg={10} md={8} sm={4}>
                  <TreeDataGrid
                    columns={treeColumns}
                    description="Regions contain clusters that contain nodes."
                    nodes={infrastructureTree}
                    title="Infrastructure"
                  />
                </Column>
              </Grid>
            </TabPanel>

            <TabPanel>
              <Grid>
                <Column lg={10} md={8} sm={4}>
                  <Stack gap={5}>
                    <PivotGrid
                      config={pivotConfig}
                      description="Dataset size and row count by steward and status."
                      rows={allRows}
                      title="Dataset size pivot"
                    />
                    <p className={styles.note}>
                      This is a live client-side crosstab: steward (rows) by
                      status (columns), summing dataset size, with row, column,
                      and grand totals. It is a working component; only wiring
                      it into a product analytics surface stays deferred per
                      DESIGN.md.
                    </p>
                  </Stack>
                </Column>
              </Grid>
            </TabPanel>
          </TabPanels>
        </Tabs>
      </PageContainer>
    </main>
  );
}

function Detail({
  label,
  value,
}: Readonly<{ label: string; value: string }>): ReactNode {
  return (
    <div className={styles.detail}>
      <span className={styles.detailLabel}>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function Footer({ count }: Readonly<{ count: number }>): ReactNode {
  return <div className={styles.footer}>Showing {count} datasets.</div>;
}
