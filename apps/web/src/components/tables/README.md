# Table component blocks

Canonical Carbon-based tables for the web app. **Reuse these. Do not hand-roll
Carbon `DataTable`/`Table` markup in a page or component, and do not add another
table library.** Every cube data-table and item-table variation is covered by
one of the three components below plus props.

Location: `apps/web/src/components/tables/`. Import directly, for example
`import { DataGrid } from '../tables/data-grid'`.

## When to use which

| Need                                                                                                                          | Component                                                                                       |
| ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| A flat row list with any mix of sorting, selection, search, pagination, scrolling, virtualization, column tools, totals, etc. | `DataGrid` (`data-grid.tsx`)                                                                    |
| Rows that expand into nested child rows (multi-level tree)                                                                    | `TreeDataGrid` (`tree-data-grid.tsx`)                                                           |
| A crosstab that aggregates a measure across two dimensions                                                                    | `PivotGrid` (`pivot-grid.tsx`) — showcase only, product analytics stay deferred per `DESIGN.md` |

`DataGrid` is the default. Reach for the other two only for their distinct row
shapes. States (`ready`, `loading`, `empty`, `error`) are a `DataGrid` prop, not
a separate component.

## Data model

```ts
type CellValue = string | number | boolean | null | undefined;
type GridRow = { id: string } & Record<string, CellValue>; // stable id required
type GridColumn = {
  key: string; // matches a GridRow field
  header: string;
  sortable?: boolean; // honored only when the grid has `sortable`
  hideable?: boolean; // shows in the column menu
  pinned?: boolean; // sticky-left; put pinned columns first
  width?: number; // px; resizing updates it
  align?: 'start' | 'end';
  colorToken?: string; // Carbon custom property for the whole column, e.g. '--cds-text-secondary'
  renderCell?: (row: GridRow) => ReactNode; // per-row visuals (tags, status, links)
};
```

Keep `row[column.key]` primitive so sorting and search work; use `renderCell`
for anything visual. See `fixtures.ts` for synthetic examples. **Never add real
customer, employee, company, transaction, or analytics data.**

## DataGrid props (the toggle surface)

Everything is off by default; turn on only what the page needs.

- Density and look: `size` (`xs`–`xl`, default `sm`), `zebra`, `wrapCells`.
- Sorting: `sortable`, `multiSort` (shift-click), `initialSort`, `lockSort`
  (fixed order, non-interactive).
- Selection: `selection` (`none`/`single`/`multi`), `batchActions` (text-only,
  needs `multi`), `selectAllScope` (`page`/`all`), `onSelectionChange`.
- Search: `search`, `searchPlacement` (`toolbar`/`persistent`). Pass `onSearch`
  to switch client filtering to server search.
- Pagination: `pagination`, `paginationMode` (`client`/`server`), `pageSize`,
  `pageSizes`. Server mode needs `page`, `totalItems`, `onPageChange`.
- Rows: `rowNumbers`, `onRowClick`, `reorderableRows` (+
  `onRowReorder`/`onRowDrop`).
- Columns: `columnMenu` (show/hide), `reorderableColumns` (drag headers),
  `resizableColumns` (drag edges), `persistKey` (saves order/width/visibility to
  localStorage).
- Scroll and size: `stickyHeader`, `maxHeight` (scroll region), `virtualized` (+
  `rowHeight`), `infiniteScroll` (+ `hasMore`, `onLoadMore`).
- Cells: `cellSelection` (spreadsheet range).
- Extras: `totalsRow`, `footer`.
- State: `state`, `loadingMode` (`skeleton`/`overlay`), `emptyLabel`,
  `errorLabel`.

Full types live in `types.ts`.

## Welcomed combinations and conflicts

- **Server-backed list**: `pagination` + `paginationMode="server"` +
  `page`/`totalItems`/`onPageChange`, usually with `onSearch` for server search.
  Same UI as client mode; you supply the data.
- **Long client dataset**: `virtualized` + `maxHeight` + `stickyHeader`.
  `virtualized` renders only visible rows and **ignores `pagination`** (pick
  one).
- **Feed / load-more**: `infiniteScroll` + `hasMore` + `onLoadMore`. Also
  ignores `pagination`. Do not combine with `virtualized`.
- **Selection workflows**: `selection="multi"` + `batchActions`. `batchActions`
  do nothing without `multi`.
- **Pinned wide table**: mark leading columns `pinned` and enable `maxHeight` so
  there is something to scroll horizontally past.
- **Persisted layout**: `persistKey` only makes sense with `resizableColumns`,
  `reorderableColumns`, or `columnMenu`.
- `lockSort` disables interactive sorting even if `sortable` is set; use it for
  a fixed presentation order.
- `cellSelection` is a demo/inspection affordance; do not combine it with
  `onRowClick` (both consume the same clicks).

## Putting a table on a real page

Product pages live under `apps/web/src/app/(product)/<segment>/page.tsx`, render
inside the shared `PageContainer`, and get the shell chrome (header,
breadcrumbs, navigation) automatically. Do not hand-roll the grid/column layout;
`PageContainer` and the shell own it.

```tsx
// apps/web/src/app/(product)/reports/page.tsx
import PageContainer from '../../../components/page-container';
import { DataGrid } from '../../../components/tables/data-grid';
import { Heading } from '@bap/design-system/react';

export default function ReportsPage() {
  return (
    <PageContainer>
      <Heading>Reports</Heading>
      <DataGrid
        title="Reports"
        columns={columns}
        rows={rows}
        sortable
        pagination
        search
      />
    </PageContainer>
  );
}
```

Adding a new top-level `(product)` segment also requires registering its slug in
the reserved-slug contract (`lib/organizations/slug.ts`, its test, the DB
migration, and the breadcrumb label in `shell/breadcrumb-trail.ts`) in the same
pull request. Nesting under an existing segment needs none of that.

## Live showcase

`/design-system/tables` (`components/tables-showcase/`) renders all three
components with a controls panel that toggles every `DataGrid` feature. Use it
to see a variation before wiring it into a page.

## Boundaries

- Import Carbon only through `@bap/design-system/react`; icons through the
  curated `@bap/design-system/icons` facade. These components use no icons on
  purpose so they stay within the facade contract.
- Colors come from Carbon theme custom properties (`var(--cds-*)`), never raw
  hex.
- These primitives are the only components allowed to use inline `style` in
  product UI (they compute widths, pin offsets, and virtualization heights at
  runtime); the ESLint rule exempts `src/components/tables/**` for that reason.
