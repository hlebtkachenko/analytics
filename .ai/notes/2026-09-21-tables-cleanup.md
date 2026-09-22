# Tables cleanup notes

Cumulated knowledge from the members-table rework (2026-09-20/21), so the same
fixes can be applied to every other table in the app. This is a backlog and a
how-to, not a change to run now. Do not auto-fix other tables from this file;
each needs its own review.

## Table inventory

Sanctioned path (CLAUDE.md boundary): application tables must reuse
`@bap/design-system/blocks` (`DataGrid`, `TreeDataGrid`, `PivotGrid`) and never
hand-roll Carbon `DataTable` markup in a page.

- Uses the `DataGrid` block (compliant):
  - `apps/web/src/app/(product)/organizations/workspace-list.tsx`
  - `apps/web/src/app/(product)/[orgSlug]/entities/entities-view.tsx`
  - `apps/web/src/app/(product)/account/account-view.tsx`
  - `apps/web/src/app/(product)/account/security/security-view.tsx`
  - `apps/web/src/components/tables-showcase/tables-showcase.tsx`
  - `apps/web/src/app/(product)/documents/page.tsx` (documents, migrated
    2026-09-22)
  - `apps/web/src/components/datasets/dataset-table.tsx` (datasets, migrated
    2026-09-22)
- Hand-rolls Carbon `DataTable` (boundary violation, cleanup targets):
  - `apps/web/src/app/(product)/[orgSlug]/members/members-view.tsx` (members)

Strategic fix: migrate the remaining hand-rolled table to the `DataGrid` block.
The block already solves empty state, loading skeleton, row actions, expandable
detail rows, toolbar actions, and a11y headers through props (`state`,
`loadingMode`, `emptyLabel`, `rowActions`, `renderRowDetail`, `toolbarActions`),
so migrating fixes several issues below at once. Members was fixed in place
(kept hand-rolled) this round; whether to migrate it to the block is still open.

## Issues found on members, root cause, and fix (each generalizable)

1. Table floats, not on the grid.
   - Cause: the table sits inside Carbon `Tabs > TabPanel` and
     `.cds--tab-content` applies `padding: $spacing-05` (16px), pushing the
     table off the grid column line the heading/tabs sit on.
   - Fix: on the tab panel class,
     `&:global(.cds--tab-content) { padding-inline: 0 }` (doubled-class
     specificity beats Carbon's single class). General rule: any table inside a
     padded wrapper (tabs, cards) drifts off the grid; zero the horizontal inset
     so its edges land on the grid column.

2. Filters must be the Carbon "multiple filters with batch updates" pattern.
   - Shape: ONE funnel `IconButton` in the toolbar opens ONE `Popover` panel
     with the filter categories as side-by-side checkbox columns; footer has two
     flush full-width buttons, `Reset filters` (secondary/dark) and
     `Apply filters` (primary/blue). Selection is staged; nothing filters until
     Apply. The funnel shows an applied-count badge. No separate applied-filter
     tag row.
   - Gotchas:
     - Carbon caps `.cds--popover-content` at `max-inline-size: 368px`, which
       clips a 3-column panel; override to `max-inline-size: none` on the
       popover content class.
     - Carbon `MultiSelect`/`Dropdown` are Downshift-based and cannot be driven
       by `fireEvent` in jsdom. Extract the pure filter logic to a plain module
       and unit-test that; drive plain `Checkbox` inputs in component tests.

3. Empty state must be the table itself, not a floating `Tile`.
   - Fix: always render the table; on zero rows show a contextual empty body
     row. For the `DataGrid` block this is the `state="empty"` + `emptyLabel`
     prop.

4. Loading state on every table.
   - Fix: render `DataTableSkeleton` while an async reload is in flight
     (hand-rolled), or `state="loading"` + `loadingMode` (block).

5. Accessibility: empty table headers fail axe `empty-table-header`.
   - The expand column and the row-actions column have no visible header text;
     the axe rule ignores `aria-label` and requires visible text.
   - Fix: put screen-reader-only text in those headers (visually-hidden span;
     the pattern lives in `packages/design-system/src/blocks/data-grid.tsx`).
     The block already does this; hand-rolled tables must add it.

6. Icon-only toolbar buttons (Filter funnel, Export download).
   - Icon-only `Button renderIcon` is forbidden by `icon-contract.test.tsx`
     (requires a visible text label, non-self-closing, no `hasIconOnly`). Use
     Carbon `IconButton` with a direct `<Icon/>` child instead (tooltip label).
   - Adding an icon means: (a) add it to the curated facade
     `packages/design-system/src/icons.ts`; (b) pin it in
     `icon-contract.test.tsx` (`reviewedImports` for the file + a
     `directCallsites` entry, placed in filesystem-walk order); AND (c) add it
     to the package-level curated lists
     `packages/design-system/src/icons.test.tsx` and `tokens.test.ts`. Missing
     (c) was a real red-test gap because per-package `build` was run but not
     `test`.

7. Row-action overflow menu naming.
   - Members names each row menu "Actions for {name}" for accessibility; the
     `DataGrid` block uses Carbon's default "Options". Operational/browser specs
     must target the correct name per table.

8. Toolbar/table conventions agreed with Hleb.
   - Pagination default 10 rows (`pageSizes [10, 25, 50]`).
   - Status shown as an inline Carbon `Tag` column (green Active / gray
     Inactive), not in the expanded row.
   - No row-height control in the table; density belongs on a preferences page
     and applies app-wide.
   - Export is icon-only (`IconButton` + `Download`), consistent with the
     funnel.

## Cross-cutting standard to apply to every table

Export icon-only; batch-popover filter where filters exist; empty state renders
the table; loading renders a skeleton; visible (sr-only) text on every header;
pagination default 10; icon buttons via `IconButton` + curated facade icon.

## Per-table backlog (review, do not auto-apply)

- members-view: fixes applied in place this round; open decision to migrate to
  the `DataGrid` block.
- documents/page.tsx: migrated to `DataGrid`. Server sort arrived as the new
  block props `sortMode`, `sort` and `onSortChange`; the kind and status
  MultiSelects became one filter facet; the floating empty `Tile` became
  `state="empty"` with `emptyLabel`, and `Clear filters` became a toolbar
  action. The partner picker and the date range stay page-level controls because
  the block has no such inputs.
- datasets/dataset-table.tsx: migrated to `DataGrid`; static rows, no toolbar.
- entities-view, workspace-list, account-view, security-view: already
  `DataGrid`; verify they set empty/loading states and that any Export/toolbar
  icons are icon-only and consistent.
