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

Three application-level components live in `apps/web/src/components/tables/` and
are the only sanctioned tables:

- `DataGrid`: one toggle-driven grid built on Carbon table primitives. Density,
  zebra, wrapping, single/multi/fixed sort, row and cell selection, bulk
  actions, client and server search, client and server pagination, row numbers,
  clickable rows, sticky header, scroll region, virtualization, infinite scroll,
  column menu, column reorder, column resize, pinned columns, persisted layout,
  totals row, footer, per-row visuals, column colors, and loading, empty, and
  error states are all props. Stateful concerns are split into focused hooks
  (sort, column layout, virtual window, cell selection).
- `TreeDataGrid`: multi-level expandable rows for the tree variation.
- `PivotGrid`: a client-side crosstab that aggregates one measure across a row
  and a column dimension.

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
- The table primitives are the one exception to the product inline-style ESLint
  rule (like the shell), because they compute widths, pin offsets, and
  virtualization heights at runtime.
- `PivotGrid` aggregates a single measure and is not wired to any product
  analytics surface; analytics dashboards stay deferred per `DESIGN.md`.
  Multi-measure grouped-header pivots are a later enhancement.
- These are application components, not a workspace package, so they do not live
  in the design-system workbench, which catalogs only the Carbon Core surface.
  The showcase page is their equivalent reference.
- Number formatting is pinned to `en-US` to keep server and client render
  identical.

## Alternatives considered

- Adopt a third-party data grid (AG Grid, TanStack Table): rejected. It adds a
  dependency outside Carbon, duplicates the design system, and would need heavy
  restyling to match Carbon tokens.
- Rebuild each cube variation as a separate table: rejected as unmaintainable.
- Place the components in `packages/design-system`: rejected. They are
  application-specific and, by the two-consumer rule, do not yet justify a
  shared package.
