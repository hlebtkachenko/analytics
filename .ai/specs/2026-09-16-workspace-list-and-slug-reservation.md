# Workspace List and Create Pages in Carbon, plus Reserved-slug Fix

**Date:** 2026-09-16

## Problem

`/organizations` and `/organizations/new` are still the throwaway milestone-2
pages: plain semantic HTML, no shell scaffold, no role or quota context, and no
place to act on a pending invitation. A user cannot see the workspaces they
belong to with their role, and the reserved-slug list does not yet cover the
flat workspace routes (`members`, `entities`, `settings`, `assistant`, `audit`)
that later PRs publish, so a workspace could claim one of those slugs.

## Scope

- Rebuild `/organizations` as a Carbon page in `PageContainer`: heading, a
  `DataGrid` of the user's workspaces (name, slug, your role, created; row click
  goes to `/[slug]`), a "Create workspace" toolbar action, a zero-membership
  empty state with a short checklist (create a workspace, add a legal entity,
  invite members, upload data), and an "Invitations for you" section listing
  pending invitations with Accept and Decline actions. Success and failure
  toasts.
- Rebuild `/organizations/new` as a Carbon `Form`: name, slug (auto-derived,
  editable, live validation against the slug rules and reserved list, resulting
  URL preview), remaining-of-granted quota, submit through the existing
  `createOrganizationAction`; inline error for quota exhausted and slug taken.
- Relabel the user-visible term to "Workspace"; the `/organizations` URL and all
  code identifiers stay "organization".
- Reserve `members`, `entities`, `settings`, `assistant`, `audit` in one
  migration, in `slug.ts`, `slug.test.ts`, and the shared corpus.
- Drop the throwaway markers from the two converted pages; update the DESIGN.md
  and ARCHITECTURE.md throwaway-page counts (they disagreed, five vs six; four
  `[orgSlug]` pages plus `/account` remain temporary after this PR) and the
  route docs.
- Out of scope: `[orgSlug]` landing, members, entities, settings, account, the
  header panels' own conversion, the audit page, and any new `apps/api` route.

## Design

Files created: `apps/web/src/app/(product)/organizations/page.tsx` (server;
moved out of `(throwaway)`), `workspace-list.tsx` (client child that owns the
grids, forms, and toasts), `page.test.tsx`; `.../organizations/new/page.tsx`
(server), `workspace-form.tsx` (client, replaces `organization-form.tsx`),
`page.test.tsx`;
`packages/db/drizzle/20260916.0001_reserve_workspace_slugs.sql`.

Files modified: `lib/organizations/actions.ts` and `actions.test.ts`;
`lib/organizations/slug.ts`, `slug.test.ts`,
`tests/fixtures/organization-slugs.json`;
`components/shell/product-navigation.ts`, `breadcrumb-trail.ts` and its test,
`header-panels.tsx` (SwitcherPanel texts), `product-shell.test.tsx`;
`i18n/resources.ts`; `packages/db/src/access.ts` and `access.test.ts`;
`DESIGN.md`; `docs/application-routes.md`.

- i18n: one new `workspaces` namespace, keys sorted, with groups `list` (title,
  createAction, empty checklist, column headers, role labels, loadError),
  `invitations` (heading, accept, decline, empty, accept/decline success and
  failure), and `create` (title, nameLabel, slugLabel, urlPreview,
  quotaRemaining, submit, slugTaken, quotaExhausted, back).
- DataGrid props: `columns` (name, slug, role, created; `sortable`,
  `initialSort` on name), `rows`, `onRowClick` (push `/${slug}`),
  `toolbarActions` (primary "Create workspace" -> `/organizations/new`), `size`
  `sm`, `state` for loading/error. The zero-membership checklist renders instead
  of the grid, not as a grid empty state. Invitations use a second `DataGrid`
  (organization name, role, expires) with a `renderCell` action column holding
  two server-action `<form>` buttons.
- Your role: a new narrow `@bap/db` read accessor
  `listWorkspaceMemberships(pool, subjectId)` returns
  `{ id, name, slug, role, createdAt }` in one query over `auth.member` join
  `auth.organization`, matching the read-accessor pattern locked for the account
  sessions list. Better Auth `listOrganizations` omits the caller's role, so a
  per-organization `listMembers` loop is rejected as N+1.
- Server actions: `createOrganizationAction` already exists and is reused. New:
  `acceptOrganizationInvitationAction` and
  `declineOrganizationInvitationAction`, each reading `invitationId` from
  `FormData`, re-checking the session, and calling `auth.api.acceptInvitation` /
  `auth.api.rejectInvitation` with the request headers; they redirect back to
  `/organizations` with a `?result=` marker the client turns into a toast
  (existing `resultPath` pattern).
- Validation: invitation id is validated as `z.string().min(1)` in the action
  before any auth call; slug is validated live in the client with
  `organizationSlugSchema` plus the reserved set and again server-side in
  `createOrganizationAction`. No organization id from the browser selects a
  tenant.
- Migration sketch: a `DO $$ ... $$` pre-check that
  `RAISE EXCEPTION ... USING ERRCODE = 'check_violation', CONSTRAINT = 'organization_slug_reserved_check'`
  if any of the five slugs already exist in `auth.organization`, then
  `DROP CONSTRAINT` and
  `ADD CONSTRAINT organization_slug_reserved_check CHECK (slug NOT IN (...))`
  with the current list plus the five appended in that order. It touches the
  constraint, so `DATABASE_MIGRATION_COMPATIBILITY` in
  `packages/db/src/access.ts` is bumped to `20260916.0001` in the same PR.

## Security

Invitation ids never appear in a URL or a log: they travel only in a hidden form
field and the server-action body, matching the rule in spec 2026-09-01. Both
actions re-check the browser session, and Better Auth compares the invitation
email to the authenticated user's email, so a user can only accept or decline an
invitation addressed to them. No organization id from the browser is used to
select a tenant; the list and role reads are scoped to `session.user.id`. The
migration adds no table, role, or grant.

## Verification

- `page.test.tsx` for both pages, fetch-stubbed, inside `I18nProvider` and
  `ToastProvider`; server-action tests for accept and decline; the breadcrumb
  test for the Workspace label; the slug tests and corpus parity.
- Gate: `pnpm --filter @bap/design-system test`, `pnpm --filter @bap/web lint`,
  `pnpm --filter @bap/web typecheck`, `pnpm --filter @bap/web test`,
  `pnpm --filter @bap/web build`, then `pnpm check`. Because the migration edits
  the constraint, also run `pnpm test:integration`.

## Open questions

1. Breadcrumb label for the `/organizations` module: "Workspaces" (plural, list)
   or "Workspace" everywhere. Assumed "Workspaces" for the list crumb, "Create
   workspace" for the child.
2. Does the workbench/DataGrid expose a first-class empty-state slot rich enough
   for the four-item checklist, or is a plain `PageContainer` block the right
   place for it.
3. Should the invitations section hide entirely when empty, or show a short
   empty message. Assumed a short empty message.

## Corrections (2026-09-16)

Corrected after an advisor review verified each point against the code, before
implementation.

1. Bumping `DATABASE_MIGRATION_COMPATIBILITY` (`packages/db/src/access.ts`) to
   `20260916.0001` is mandatory because it exact-matches
   `current_migration_version()`; the same id is pinned in
   `packages/db/src/documents.integration.test.ts`.
2. `packages/db/src/postgres.integration.test.ts` hardcodes the constraint
   literal: the five slugs are appended there, a collision proof is added for
   the new migration, and `docs/database-isolation.md` moves from 17 to 22
   literals.
3. The migration copies the `20260914.0002_documents.sql` guard-then-replace
   style (a `DO` pre-check raising `check_violation` with
   `CONSTRAINT organization_slug_reserved_check`, then `DROP` + `ADD`).
   Migrations run in one transaction under an advisory lock; an applied
   migration file is never edited.
4. The `?result=` to toast bridge is new code: a small client component using
   `useSearchParams` and `useToast`, then `router.replace` to strip the query.
   Existing consumers render inline notifications; this PR introduces the toast
   bridge for `/organizations` only.
5. `listWorkspaceMemberships` copies `resolveOrganizationRoute` (join plus
   `membershipRoleSchema.safeParse`) and is exported from
   `packages/db/src/index.ts`. `getOrganizationCreationQuota` already exists.
6. Better Auth 1.7.4 `acceptInvitation` and `rejectInvitation` take
   `{ invitationId }`, both enforce the recipient email match and a verified
   email. The pending list is `auth.api.listUserInvitations`. Acceptance sets
   the active organization internally, which no BAP operation reads.
7. `createOrganizationAction` widens the `resultPath` union with `slug-taken`
   and `quota-exhausted` markers, mapped to inline errors on the create page;
   the `ORGANIZATION_ALREADY_EXISTS` Better Auth error becomes `slug-taken` and
   an exhausted quota becomes `quota-exhausted`.
8. Moving out of `(throwaway)`: the icon-contract test paths and the
   `organization-form.tsx` assertions are updated, the empty `(throwaway)` group
   folder is removed (the `[orgSlug]` pages are not in it), the dead
   `(throwaway)` ignores in `packages/eslint-config/next.mjs` are removed, and
   each converted `page.tsx` renders `PageContainer` because the
   `bap/product-page-container` rule now applies.
9. DESIGN.md and ARCHITECTURE.md disagreed on the throwaway count (five vs six);
   four `[orgSlug]` pages plus `/account` remain temporary, fixed across
   DESIGN.md, ARCHITECTURE.md, docs/testing.md, docs/development.md,
   docs/security.md, and docs/authentication.md.
10. Label sites `components/shell/global-search.tsx` and the rail table in
    docs/application-routes.md are relabelled. Any new icon would need
    `packages/design-system/src/icons.ts`, `icons.test.tsx`, and the
    icon-contract reviewed lists; a text-only toolbar action is used so no new
    icon is added.
11. Open questions settled: the list crumb reads "Workspaces", the child reads
    "Create workspace", the checklist is a plain `PageContainer` block, and the
    invitations section is hidden when empty (no `invitations.empty` key).
