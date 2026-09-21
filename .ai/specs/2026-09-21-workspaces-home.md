# Workspaces home page

## Problem

After login the caller lands on `/workspaces`, which today is a single flat
table plus an invitations table and a get-started tile. It does not read as a
home page: there is no way to start building, no separation between the
workspaces the caller owns and the ones they only belong to, and no view of
inactive memberships. This is a visual-iteration pass to make the page cohesive.

## Scope

Does:

- Return membership `status` from `listWorkspaceMemberships` and drop the
  `status = 'active'` predicate so every membership of the caller is returned.
- Rebuild `/workspaces` to render, top to bottom: a build section (gradient
  "Build" hero tile plus a scrollable row of four upsell tiles), a "My
  workspaces" table (rows where role is owner), and a "Member of" table (rows
  where role is admin or member, any status) with a faceted filter.
- Add the `workspaces.hero`, `workspaces.upsell`, extended `workspaces.list`,
  `workspaces.status`, and `workspaces.filter` i18n keys.

Does not:

- Touch the members folder or extract a shared filter package (future backlog).
- Change the invitations table or the `?result=` toast handling.
- Add a new facade icon; reuses `ArrowRight`, `Launch`, `Filter`.
- Wire the upsell tiles to real destinations (placeholder copy and `#` links).

## Design

- `packages/db/src/access.ts`: `WorkspaceMembership` gains
  `status: MembershipStatus` (`z.enum(['active','inactive'])`). The query selects
  `membership.status` and no longer filters by it. Invalid status parses are
  dropped like invalid roles.
- `apps/web/src/app/(product)/account/page.tsx`: the shared function now returns
  inactive rows, so this consumer filters to `status === 'active'` to keep its
  existing switcher behaviour (an inactive workspace is not enterable).
- `apps/web/src/app/(product)/workspaces/page.tsx`: `WorkspaceRow` gains
  `status`; the page maps `membership.status` onto each row.
- `workspace-list.tsx`: rebuilt into build section, owner table, member table.
  A local `FilterButton` (funnel `IconButton` + count badge + Carbon `Popover`)
  and `workspace-filter-flyout.tsx` mirror the members look. Pure predicate
  `workspaceMatchesFilters` lives in `workspace-filter.ts`, unit tested.
- `workspace-build-section.tsx` + `.module.scss`: gradient hero `ClickableTile`
  and a scrollable upsell `Tile` row.
- Icons: hero renders `<ArrowRight />` directly, the funnel renders `<Filter />`
  directly, the upsell "Learn more" `Link` uses `renderIcon={Launch}`. The icon
  AST contract test pins these.

## Security

Display-only membership metadata (name, slug, role, status, created date) that
the caller already has access to. No new boundary crossed, nothing logged.
Membership rows are validated at the DB boundary through the role and status
enums.

## Verification

- `packages/db/src/access.test.ts`: the list snapshot carries `status`.
- `workspace-filter.test.ts`: the predicate matches every non-empty category.
- `icon-contract.test.tsx`: the new import, callsite and direct-icon entries.
- Gate: `pnpm --filter @bap/db typecheck && pnpm --filter @bap/db test &&
  pnpm --filter @bap/web typecheck && pnpm --filter @bap/web lint &&
  pnpm --filter @bap/web test`.

## Open questions

None. The brief called the workspaces page the only caller of
`listWorkspaceMemberships`; `account/page.tsx` is a second caller, handled above.
