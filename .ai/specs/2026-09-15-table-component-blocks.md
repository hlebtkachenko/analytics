# Table component blocks

- Date: 2026-09-15
- Status: delivered

## Problem

Product pages need tables and there is no shared one. The cube-ui-kit reference
shows more than forty data-table and item-table variations. Carbon gives table
primitives but no full-featured grid, no pivot, no virtualization, and no column
reorder, resize, pinning, or multi-level tree. Left unaddressed, every page
would hand-roll Carbon markup or add a grid library, and variations would drift.

## Scope

Adds three components under `packages/design-system/src/blocks/`, exposed as the
`@bap/design-system/blocks` entrypoint, plus a live app showcase and a workbench
story.

Does:

- `DataGrid`, a toggle-driven grid over Carbon primitives covering density,
  sorting (single, multi, fixed), row and cell selection, bulk actions, search
  (client and server), pagination (client and server), row numbers, clickable
  rows, sticky header, scroll region, virtualization, infinite scroll, column
  menu, column reorder, column resize, pinned columns, persisted layout, totals
  row, footer, per-row visuals, column colors, and loading, empty, and error
  states.
- `TreeDataGrid`, multi-level expandable rows.
- `PivotGrid`, a client-side crosstab of one or more measures, with grouped
  column headers for multiple measures.
- A showcase at `/design-system/tables` with a controls panel and a details
  panel, rendered inside `PageContainer`, and a workbench story under **BAP
  Extensions** tagged `bap-extension`.

Does not:

- Wire any table to a real data source or product analytics surface.
- Give `TreeDataGrid` the full `DataGrid` toggle surface.
- Add a new product route or reserved slug (the showcase reuses the
  already-reserved `design-system` segment).

## Design

- Components live in the design system so both the app and the workbench can
  import them; they render Carbon primitives (via the relative `../react`
  facade) and use semantic theme tokens (`var(--cds-*)`) only. No new
  dependencies, no icons. The package ships source, like every other entrypoint;
  a `*.module.scss` ambient type and a `ResizeObserver` test shim were added so
  they typecheck and their tests run in the package.
- Stateful concerns are isolated in hooks: `use-grid-sort`, `use-column-layout`
  (order, width, visibility, localStorage persistence), `use-virtual-window`
  (fixed-height windowing), `use-cell-selection` (rectangular range).
- `types.ts` defines `GridColumn`, `GridRow`, and the `DataGridProps` toggle
  surface. `fixtures.ts` holds neutral synthetic data (datasets, jobs, nodes),
  exposed at `@bap/design-system/blocks/fixtures`.
- Advanced features Carbon lacks are hand-rolled dependency-free: HTML5 drag for
  column and row reorder, pointer events for resize, `IntersectionObserver` for
  infinite scroll, fixed-height slicing for virtualization, sticky positioning
  for pinned columns.
- Number formatting is pinned to `en-US` so server and client agree.
- The design-system ESLint config allows the runtime inline styles the grid
  needs; the product inline-style ban never reaches the package.
- Reuse is enforced by a boundary rule in the repository instructions; usage is
  documented in `packages/design-system/src/blocks/README.md` and
  `docs/development.md`. The decision is recorded in
  `docs/adr/0012-table-component-blocks.md`.

## Security

No trust boundary is crossed. The components are client-side and presentational,
render only developer-supplied synthetic data, use no `dangerouslySetInnerHTML`
or other unsafe API, and read only same-origin `localStorage` for the optional
persisted layout. A security review found nothing.

## Tests and verification

Unit tests cover `DataGrid` behavior (render, sort direction with missing values
last, client search, multi selection, empty state, client paging), tree
expansion, and pivot aggregation (`sum`, `count`, `avg`, totals). `pnpm check`
passes: format, lint, typecheck, test, and build.
