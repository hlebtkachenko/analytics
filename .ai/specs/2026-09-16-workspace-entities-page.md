# Legal Entities Page in Carbon

**Date:** 2026-09-16

## Problem

`/[orgSlug]/entities` is still the throwaway milestone-2 page: plain HTML, no
shell scaffold, one inline `<form>` per row and per create, and a single
`?result=success|error` line. Legal entities are real backend data (list,
create, edit, delete already exist through the BFF and `apps/api`), so this
should become a Carbon page like the documents page, with no new backend work.

## Scope

- Replace `/[orgSlug]/entities/page.tsx` with a Carbon page inside
  `PageContainer`: a heading with the workspace name and a `DataGrid` of legal
  entities (name, kind, registration number, created; sortable; searchable).
- Toolbar action "Add legal entity" only with `createEntities`; per-row overflow
  Edit (`updateEntities`) and Delete (`deleteEntities`, `isDelete`), each gated.
- Create and edit are one `ComposedModal` form (name, kind `Select`,
  registration number); delete is a danger confirm `ComposedModal`.
- Success and failure toasts; `InlineNotification` for a failed list load; an
  empty-state block with the create action when the list is empty and the user
  can create, plain text otherwise. Drop the throwaway marker; correct the
  throwaway-page counts (four `[orgSlug]` pages become three) and the route row.
- Out of scope: every other `[orgSlug]` page, per-entity counts, fiscal fields,
  entity-scope UI, any new API route, BFF route, contract mirror, migration, or
  icon.

## Design

Files modified: `.../[orgSlug]/entities/page.tsx` (server component: resolve
tenant via `resolveOrganizationRouteForRequest`, read capabilities via
`readOrganizationAccess` and the initial list via `readLegalEntities`, render
`PageContainer` + the client view), its `page.test.tsx`; `i18n/resources.ts`;
and the count and marker-coverage text in `DESIGN.md`, `ARCHITECTURE.md`,
`docs/application-routes.md`, `docs/authentication.md`, `docs/security.md`,
`docs/testing.md`.

Files created: `.../[orgSlug]/entities/entities-view.tsx` (client child owning
the grid, both modals, and toasts), plus a `.module.scss` only if needed.

Removed to `_junk/`: the `create`/`update`/`delete` `LegalEntityAction`s and
their cases in `entity-actions.ts` / `entity-actions.test.ts` (the throwaway
page was their only caller); `updateMemberEntityScopeAction` stays (PR E uses
it).

- Nested route under `[orgSlug]`, so per `docs/product-pages.md` it needs no
  rail entry, no slug reservation, no new breadcrumb (the `entities` label
  exists), and no new contract mirror (`legalEntitySchema` /
  `legalEntityListSchema` are in `lib/datasets/client.ts`).
- i18n: one new `entities` namespace, keys sorted, groups `list` (title,
  column*, searchLabel, addAction, empty, emptyCreatable, loadError), `kinds`
  (company, soleTrader), `actions` (edit, delete), `form` (createTitle,
  editTitle, nameLabel, kindLabel, registrationLabel, submit, cancel,
  nameInUse), `delete` (title, body, confirm, cancel), `toast`
  (create/update/deleteSuccess, failure).
- DataGrid props: `columns` (name; kind and registration via `renderCell` for
  the label and the null dash; created formatted), `rows`, `sortable`,
  `initialSort` on name, `search`, `size="sm"`, `toolbarActions` (create, only
  with `createEntities`), `rowActions` (Edit, then Delete with `isDelete`; each
  only with its capability); `errorLabel`/`state` exist but the server-rendered
  load failure surfaces as an `InlineNotification`. The empty state renders as a
  `PageContainer` block, not the grid `emptyLabel`, so the create button can sit
  with the text.
- Capabilities reach the page from the server component:
  `readOrganizationAccess` (the existing access BFF call,
  `organizationAccessSchema`) yields the three entity capabilities, passed as
  booleans to the view; `apps/api` re-checks each.
- Mutations submit by client `fetch` to the existing BFF routes via
  `legalEntitiesPath` / `legalEntityPath` (POST, PATCH, DELETE), not the removed
  server actions: `runScopedAction` redirects and collapses every failure to one
  `error` marker, so it cannot keep a 409 distinct for an inline field error or
  the modal open on failure. On success the view toasts, closes the modal, and
  calls `router.refresh()`.
- Validation: the modal validates its draft with a small local zod schema (name
  1..200, kind enum, registration number pattern 1..32) before the fetch; the
  BFF (`legalEntityCreateBodySchema` / `...UpdateBodySchema`) and `apps/api`
  (`createLegalEntityRequestSchema` / `...UpdateRequestSchema`) validate again.
- Error mapping: 404 (entity not visible, no enumeration) becomes a generic
  failure toast plus `router.refresh()`, never revealing the id. 409 means the
  name is already used (the unique `(organization_id, name)` index
  `legal_entity_organization_name_key`, not the registration number) and becomes
  an inline error on the Name field, modal left open. Any other non-`ok` is a
  failure toast, modal left open.

## Security

Entity ids travel only inside the BFF path segment (`legalEntityPath` encodes
the id) on PATCH and DELETE, never in a query string or a log. `apps/api`
(`resolveTenantAccess`) re-checks the capability on every mutation; the browser
booleans only choose which controls render. No organization id from the browser
selects a tenant: `resolveOrganizationRouteForRequest` maps the route slug to
the tenant server-side, and the BFF re-derives access from the resource JWT.

## Verification

`page.test.tsx` renders the view inside `I18nProvider` and `ToastProvider` with
`vi.stubGlobal('fetch')` and mocked `next/navigation`, covering: list renders
rows; create success (toast, modal closes, refresh); create 409 (inline name
error, modal open, no toast); delete confirm (DELETE sent, success toast);
capability-hidden actions (no toolbar action without `createEntities`, no row
overflow without update/delete); load error (`InlineNotification`). No BFF
function changes, so no `bff.test.ts` cases. Gate: the five commands in
`docs/product-pages.md` step 11, then `pnpm check`. No migration, no
`test:integration`.

## Open questions

1. Delete gating: by the `deleteEntities` capability (assumed, matching the API)
   or restricted to the owner role as the build-plan row F wording suggests.
2. Refresh after a mutation: `router.refresh()` to re-run the server component
   (assumed) or a client `getJson` re-read of `legalEntitiesPath`.

## Correction (2026-09-16, advisor-verified)

This supersedes the conflicting details above where they disagree.

1. Scope also touches `apps/web/src/components/icon-contract.test.tsx`: remove
   the entities page from `throwawayPages` and let the Phase 10 marker
   assertions iterate the shortened list.
2. Orphan cleanup is a plain deletion in the commit, not a move to `_junk/` (git
   history keeps them; `_junk/` is gitignored and applies to whole files).
   Delete `createLegalEntity`, `updateLegalEntity`, `removeLegalEntity` and
   `LegalEntityInput` from `entities.ts`, the three legal-entity server actions
   from `entity-actions.ts`, and their cases in the two test files. Keep
   `updateMemberEntityScopeAction` and `writeMemberEntityScope` (the members
   page uses them).
3. After each successful mutation the view re-reads the list with
   `getJson(legalEntitiesPath(organizationId))` and `legalEntityListSchema`, not
   `router.refresh()`. Delete is gated by the `deleteEntities` capability
   boolean from `readOrganizationAccess` (owner-only upstream, so the "owner
   only" docs wording stays true).
4. The create/edit and delete dialogs use `Modal` from
   `@bap/design-system/react` (the `documents/new` pattern), not
   `ComposedModal`; delete is `danger` with `onRequestSubmit`.
5. Mutations go through a small `mutateJson` helper next to `getJson` in
   `lib/datasets/client.ts`: it redirects to sign-in on 401 exactly like
   `getJson`, and returns the status so the view can branch on `status === 409`
   (the BFF passes 409 through with a constant body) into an inline error on the
   Name field, keeping the modal open.
6. `initialSort` is an array of `SortSpec`; `GridRow` cells stay primitive, so
   the rows are flat strings (kind label, a dash for a missing registration
   number, and `created` as an ISO date string like the workspace list).
7. Capabilities come from `readOrganizationAccess` in the page; the `[orgSlug]`
   layout provides only name, role, and slug.
8. Docs move from "four" to "three" temporary `[orgSlug]` pages
   (`ARCHITECTURE.md`, `DESIGN.md`, `docs/security.md`, `docs/testing.md`,
   `docs/authentication.md`), correct `ARCHITECTURE.md` where it claimed every
   mutation is a server action, and update `docs/application-routes.md` so the
   entities row reads Carbon and fetch-based and no longer counts among the
   temporary pages.
