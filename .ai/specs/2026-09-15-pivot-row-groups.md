# Pivot row groups (tree pivot)

- Date: 2026-09-15
- Status: proposed (deferred; build when an analytics surface needs it)

## Problem

`PivotGrid` groups rows by a single dimension (`config.rowDimension`). Real
crosstabs nest several row dimensions, for example steward then region then
status, each level shown as an indentable group with its own subtotal. Without
nested row groups the pivot cannot express the hierarchy the cube reference and
`carbondesignsystem.com` pivot examples show, so a page that needs a grouped
crosstab would fall back to a flat table.

## Scope

Extends `PivotGrid` and its aggregation to support an ordered list of row
dimensions with per-level subtotals, reusing the existing tree expand and
flatten behavior from `TreeDataGrid`.

Does:

- Add `PivotConfig.rowDimensions?: readonly string[]` (outer to inner). Keep
  `rowDimension?: string` as the single-level form. Exactly one of the two is
  set; `rowDimensions` of length 1 equals the current behavior.
- Nested aggregation: `aggregatePivot` builds a row-group tree keyed by the
  tuple of row-dimension values, and computes each measure at every group node
  (leaf cell, group subtotal, and grand total) in one pass over the rows.
- Render each row-dimension level as an indented, collapsible group header row
  (reuse `TreeDataGrid`'s caret, expand/collapse-all, and flatten-to-visible
  logic), with a subtotal row per group and the existing grand-total band.
- Column dimension, measures, grouped multi-measure headers, and number
  formatting stay exactly as they are today.

Does not:

- Add column-dimension nesting (only row dimensions nest).
- Wire the pivot to a real analytics source. `DESIGN.md` defers analytics; this
  stays a client-side component until a surface consumes it.
- Add drag reordering of row dimensions or a pivot field picker.
- Change the single-dimension `rowDimension` call sites or the showcase default.

## Design

- `types.ts`: add `rowDimensions?: readonly string[]` to `PivotConfig`; mark the
  relationship in a comment (`rowDimension` xor `rowDimensions`). No breaking
  change: existing configs keep `rowDimension`.
- `pivot-grid.tsx`:
  - Normalize config at the top of `aggregatePivot` to `dims: string[]` =
    `rowDimensions ?? [rowDimension]`, so the rest of the function is
    dimension-count agnostic.
  - Replace the flat `rowValues: string[]` in `PivotMatrix` with a `rowGroups`
    tree: `{ key, depth, values, children, isLeaf }`, plus the same
    `cell`/`rowTotal`/`columnTotal`/`grandTotal` accessors keyed by the group
    key (the row-dimension tuple joined with the existing `KEY_SEPARATOR`). Keep
    `rowValues` as a derived flat list for the single-level path so the current
    render stays untouched when `dims.length === 1`.
  - Accumulate per measure into group-keyed maps (one entry per prefix of the
    tuple) in the single existing pass; subtotal at depth d is the sum/count for
    that prefix.
  - Render: flatten the visible `rowGroups` to rows using the same visible-node
    walk as `TreeDataGrid`; a group header row spans the value columns with an
    indent and caret; a subtotal row uses the existing `.totalCell` styling; the
    grand-total band is unchanged.
- No new external input: the pivot only reads `rows` already in memory. Validate
  nothing new; the config is developer-supplied, not user input.

## Security

No new data movement. The component aggregates in-memory synthetic rows on the
client, sends nothing to any provider, logs nothing. The existing rule holds: no
real customer, employee, company, transaction, or analytics data in fixtures.

## Verification

- Unit tests in `pivot-grid.test.tsx`: a two-dimension config produces the
  expected group tree, per-group subtotals equal the sum of their leaves, and
  the grand total equals the sum of subtotals; a one-dimension config renders
  byte-identical output to today (regression guard); expand/collapse hides and
  shows the right subtree.
- Gate: `pnpm --filter @bap/design-system test`, then `pnpm check` before push.

## Open questions

- Subtotal placement: above each group (header carries the subtotal) or a
  trailing subtotal row. Default to a trailing subtotal row to match Carbon
  totals styling; confirm with the first real consumer.
- Whether collapsed groups should still contribute to column totals (they
  should; totals are independent of expand state).
