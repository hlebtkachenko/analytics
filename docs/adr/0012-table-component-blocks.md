# ADR 0012: Table Component Blocks

- Status: accepted
- Date: 2026-09-15

## Context

Product surfaces across BAP need tables: dataset lists, job runs, membership,
audit rows, and later analytical grids. The cube-ui-kit reference exposes more
than forty data-table and item-table variations (sorting, selection, search,
pagination, tree rows, pivot, virtualization, column reorder and resize, pinned
columns, cell selection, and more). Carbon ships table primitives (`DataTable`,
`Table*`, `TableToolbar*`, `Pagination`, `DataTableSkeleton`) but no
full-featured grid, and it has no pivot, virtualization, column reorder or
resize, column pinning, or multi-level tree.

Without a shared answer, every page would either hand-roll Carbon table markup
or pull in a third-party grid, and the same variation would be rebuilt many
times with drifting behavior.

## Decision

Three components live in `packages/design-system/src/blocks/`, exposed as the
`@bap/design-system/blocks` entrypoint, and are the only sanctioned tables. They
are BAP extensions built on Carbon primitives, not native Carbon:

- `DataGrid`: one toggle-driven grid built on Carbon table primitives. Density,
  zebra, wrapping, single/multi/fixed sort, row and cell selection, bulk
  actions, client and server search, client and server pagination, row numbers,
  clickable rows, sticky header, scroll region, virtualization, infinite scroll,
  column menu, column reorder, column resize, pinned columns, persisted layout,
  totals row, footer, per-row visuals, column colors, and loading, empty, and
  error states are all props. It also carries the richer Carbon data-table
  affordances: persistent toolbar actions, a per-row overflow menu, expandable
  detail rows, opt-in inline cell editing (text, checkbox, select), and the
  action-column and drill-in pattern (`renderCell` plus `onRowClick`, no new
  API). Stateful concerns are split into focused hooks (sort, column layout,
  virtual window, cell selection).
- `TreeDataGrid`: multi-level expandable rows for the tree variation.
- `PivotGrid`: a client-side crosstab that aggregates one or more measures
  across a row and a column dimension, with grouped column headers for multiple
  measures.

Every cube variation maps onto one of these components, a `DataGrid` prop, or a
data-wiring choice (client versus server). States are a mode, not a component.
The components use Carbon primitives and semantic theme tokens only, add no
dependencies, and import no icons so they stay inside the curated icon facade.
Advanced features Carbon lacks (virtualization, infinite scroll, column reorder
and resize, pinned columns, cell selection, tree, pivot) are hand-rolled
dependency-free.

Reuse is enforced by a boundary rule in the repository instructions: product
tables must reuse these components rather than hand-roll `DataTable` markup or
add another table library. A live showcase at `/design-system/tables` renders
all three with a controls panel that toggles every feature.

## Consequences

- New product pages compose a table by choosing a component and turning on
  props, inside `PageContainer` under `(product)`; they do not rebuild tables.
- The components use runtime inline styles for widths, pin offsets, and
  virtualization heights. The design-system ESLint config allows this; living in
  the package keeps them clear of the product inline-style ban.
- The design-system workbench shows all three under a **BAP Extensions**
  section, tagged `bap-extension`, so they are discoverable next to native
  Carbon and clearly distinguished from it. The app also has a live showcase at
  `/design-system/tables` with a controls panel.
- `PivotGrid` is not wired to any product analytics surface; analytics
  dashboards stay deferred per `DESIGN.md`. Nested pivot row groups (tree pivot)
  are designed but deferred; the plan is in
  `.ai/specs/2026-09-15-pivot-row-groups.md`.
- Pinned columns switch the table to `table-layout: fixed` so declared widths
  are authoritative and sticky offsets line up; pinned cells track zebra, hover,
  and selection through classes rather than a hard-coded background.
- Inline editing builds on the stable `TextInput`, `Checkbox`, and `Select`
  primitives, not Carbon's `unstable__*` editable data table, and is opt-in per
  column so existing grids are unaffected.
- Number formatting is pinned to `en-US` to keep server and client render
  identical.

## Alternatives considered

- Adopt a third-party data grid (AG Grid, TanStack Table): rejected. It adds a
  dependency outside Carbon, duplicates the design system, and would need heavy
  restyling to match Carbon tokens.
- Rebuild each cube variation as a separate table: rejected as unmaintainable.
- Keep the components in `apps/web`: rejected. The workbench may import only
  design-system entrypoints, so app-local components could not appear there. Two
  real consumers (the app and the workbench) justify the shared entrypoint.
