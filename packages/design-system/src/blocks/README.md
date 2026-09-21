# Table component blocks

BAP extension components built on Carbon primitives (not native Carbon). They
live in the design system so both the app and the workbench can use them.
**Reuse these. Do not hand-roll Carbon `DataTable`/`Table` markup in a page or
component, and do not add another table library.** Every cube data-table and
item-table variation is covered by one of the three components below plus props.

Location: `packages/design-system/src/blocks/`, published as the
`@bap/design-system/blocks` entrypoint. Import from the entrypoint:
`import { DataGrid } from '@bap/design-system/blocks'`. Synthetic demo data is
at `@bap/design-system/blocks/fixtures`. The workbench shows all three under the
**BAP Extensions** section, tagged `bap-extension`.

## When to use which

| Need                                                                                                                          | Component                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| A flat row list with any mix of sorting, selection, search, pagination, scrolling, virtualization, column tools, totals, etc. | `DataGrid` (`data-grid.tsx`)                                                                               |
| Rows that expand into nested child rows (multi-level tree)                                                                    | `TreeDataGrid` (`tree-data-grid.tsx`)                                                                      |
| A crosstab that aggregates one or more measures across two dimensions                                                         | `PivotGrid` (`pivot-grid.tsx`) — grouped headers for multiple measures; not wired to product analytics yet |

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
  editor?:
    // inline editor; commits through onCellEdit
    | { type: 'text' }
    | { type: 'checkbox' }
    | { type: 'select'; options: readonly string[] };
};
```

Keep `row[column.key]` primitive so sorting and search work; use `renderCell`
for anything visual. See `fixtures.ts` for synthetic examples. **Never add real
customer, employee, company, transaction, or analytics data.**

## DataGrid props (the toggle surface)

Everything is off by default; turn on only what the page needs.

- Density and look: `size` (`xs`–`xl`, default `sm`), `zebra`, `wrapCells`.
- Header layout: `titleInline` renders the `title` (and `description`) on the same
  row as the toolbar (title left, controls right) instead of stacked above it;
  needs both a `title` and a toolbar. Default is the stacked layout.
- Sorting: `sortable`, `multiSort` (shift-click), `initialSort`, `lockSort`
  (fixed order, non-interactive).
- Selection: `selection` (`none`/`single`/`multi`), `batchActions` (text-only,
  needs `multi`), `selectAllScope` (`page`/`all`), `onSelectionChange`.
- Search: `search`, `searchPlacement` (`toolbar`/`persistent`). Pass `onSearch`
  to switch client filtering to server search.
- Faceted filter: `filters` (`GridFilterGroup[]`) renders a toolbar funnel with a
  count badge over a staged checkbox popover (Reset/Apply). A row passes when, for
  each group with a selection, `String(row[group.key])` is in that selection;
  applied on top of search before pagination. Selection is owned internally
  unless you pass `filterValues` + `onFilterChange` to control it.
- Pagination: `pagination`, `paginationMode` (`client`/`server`), `pageSize`,
  `pageSizes`. Server mode needs `page`, `totalItems`, `onPageChange`.
- Rows: `rowNumbers`, `onRowClick`, `reorderableRows` (+
  `onRowReorder`/`onRowDrop`).
- Actions: `toolbarActions` (persistent toolbar buttons such as a primary create
  action; `kind` defaults to `primary`), `rowActions` (`(row) => RowAction[]`
  renders a trailing per-row overflow menu; `isDelete` marks the danger item and
  sorts it last).
- Detail rows: `renderRowDetail` (`(row) => ReactNode`) turns each row into a
  Carbon expandable row that reveals the returned content when opened.
- Inline edit: mark a column with `editor` (`{ type: 'text' }`,
  `{ type: 'checkbox' }`, or `{ type: 'select', options }`) and pass
  `onCellEdit(rowId, key, value)`. A checkbox commits immediately; text and
  select open on click, commit on blur or Enter, and revert on Escape.
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
- `renderRowDetail` replaces each row with a Carbon expand row; it takes over
  row interaction, so do not also pass `onRowClick`, and do not combine it with
  `reorderableRows` (drag on an expand row is untested).
- **Action column / drill-in**: there is no dedicated prop. Use
  `column.renderCell` to render a `Button` or link (call
  `event.stopPropagation()` when rows are also clickable) and/or `onRowClick` to
  drill into a row.
- **Inline edit** needs `onCellEdit` plus a per-column `editor`. Do not put an
  `editor` on a column while `cellSelection` is on (both consume the cell's
  clicks), and keep `row[column.key]` primitive so the editor reads the value.

## Putting a table on a real page

Product pages live under `apps/web/src/app/(product)/<segment>/page.tsx`, render
inside the shared `PageContainer`, and get the shell chrome (header,
breadcrumbs, navigation) automatically. Do not hand-roll the grid/column layout;
`PageContainer` and the shell own it.

```tsx
// apps/web/src/app/(product)/reports/page.tsx
import { DataGrid } from '@bap/design-system/blocks';
import { Heading } from '@bap/design-system/react';

import PageContainer from '../../../components/page-container';

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
- They use inline `style` for runtime widths, pin offsets, and virtualization
  heights. The design-system ESLint config allows this; the product inline-style
  ban applies only to app UI, which is why these live in the package.
