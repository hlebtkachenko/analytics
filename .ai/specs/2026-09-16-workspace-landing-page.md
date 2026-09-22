# Workspace Landing Page in Carbon

**Date:** 2026-09-16

## Problem

`/[orgSlug]` is still the throwaway milestone-2 page: a bare `<h1>`, a "Your
role:" line and a plain `<ul>` of links, no shell scaffold. It is the last
temporary `[orgSlug]` page (units B, F, E, D land the list, entities, members
and settings first). Members, invitations, entities and datasets are all real
data reachable from a server render, so this becomes a Carbon overview page, no
backend work.

## Scope

- Replace `/[orgSlug]/page.tsx` with a Carbon page in `PageContainer`: heading =
  workspace name, a subtitle line with the slug and the caller's role as a
  `Tag`.
- A row of `ClickableTile` quick links, each with a real number where a count
  exists: Members (`x of 100`), Invitations (pending count, `href`
  `/<slug>/members?tab=invitations`), Entities (count), Documents, Datasets,
  Settings. Members/Entities tiles link to their pages; Datasets links to
  `/<slug>/datasets`.
- A "Next steps" `Stack` rendered only when at least one condition holds, each
  step a `Link` to the real page: no entities and `createEntities` -> create an
  entity (`/<slug>/entities`); exactly one member and `manageMembers` -> invite
  (`/<slug>/members?tab=invitations`); no datasets in scope and `uploadData` ->
  upload data (`/<slug>/documents/new`). Nothing renders when all are false: no
  empty-state text, no static tile.
- `InlineNotification` when a required read fails. Drop the last `[orgSlug]`
  throwaway marker; docs now say only `/account` stays temporary.
- Out of scope: every other `[orgSlug]` page; charts; recent activity; any new
  API, BFF route, contract mirror, migration, or icon.

## Design

Files modified: `.../[orgSlug]/page.tsx` (server component, see below) and its
`page.test.tsx`; `src/lib/organizations/entities.ts` (add `readDatasets`);
`src/lib/auth/server.ts` (extract `MEMBERSHIP_LIMIT = 100`, used by the plugin
config and the page); `i18n/resources.ts`; `components/icon-contract.test.tsx`
(drop `app/(product)/[orgSlug]/page.tsx` from `throwawayPages`, leaving only the
`/account` entries); the throwaway-page count and `[orgSlug]` landing row in
`DESIGN.md`, `ARCHITECTURE.md`, `docs/application-routes.md`,
`docs/authentication.md`, `docs/security.md`, `docs/testing.md`.

- Server-only rendering, no client child: no interaction beyond navigation, so
  it stays a server component rendering Carbon `Grid`, `Column`, `Stack`, `Tag`,
  `ClickableTile` and `Link` from `@bap/design-system/react` (client components,
  safe from a server parent with serializable `href`/children), keeping every
  count read on the server session.
- Reads, all with the resolved `organization.id`: tenant via
  `resolveOrganizationRouteForRequest(orgSlug)` (id, name, slug, role, with
  `notFound()` on null); capabilities via `readOrganizationAccess`; entities via
  `readLegalEntities` (count = length, empty = length 0); members via
  `auth.api.listMembers({ headers: await headers(), query: { limit: MEMBERSHIP_LIMIT, organizationId } })`
  (count = `total`); invitations via
  `auth.api.listInvitations({ headers, query: { organizationId } })`, counting
  only `status === 'pending'` (the call returns every status); datasets via a
  new `readDatasets` server helper wrapping `getDatasets` + `serverBffRequest`
  like `readLegalEntities`, scope-wide (no `legalEntityId`).
- `readDatasets` is a server read, not a new BFF route. There is no count
  endpoint, so the page reads the one scope-wide dataset list in full and uses
  its length for the tile and `> 0` for the "has data" check.
- Capability booleans (`createEntities`, `manageMembers`, `uploadData`) come
  from `readOrganizationAccess`; a null read fails closed (all false, no next
  steps) and surfaces the `InlineNotification`.
- i18n: one new `landing` namespace, keys sorted, groups `overview` (per-role
  labels), `tiles` (members `{{count}} of {{limit}}`, invitations, entities,
  documents, datasets, settings), `nextSteps` and `loadError`.

## Security

Server-side reads use the caller's session only: `listMembers`/`listInvitations`
carry the request `headers` and re-derive membership from the session,
`readOrganizationAccess`/`readLegalEntities`/`readDatasets` pass the session
cookie through `serverBffRequest` and the BFF mints a per-request resource JWT.
No browser id selects a tenant: `resolveOrganizationRouteForRequest` maps the
slug to the id server-side and the page passes that resolved id to every read.
No id reaches a query string or a log; capability booleans only choose which
controls render, and the API re-checks each. Only aggregate counts reach the
browser.

## Verification

`page.test.tsx` renders the awaited server component inside `I18nProvider`,
mocking `resolveOrganizationRouteForRequest`, `readOrganizationAccess`,
`readLegalEntities`, `readDatasets`, `next/navigation` and
`auth.api.listMembers`/`listInvitations`, covering: heading, slug and role Tag;
tiles show the real counts and link to the real routes (invitations tile deep
links `?tab=invitations`); invitation count includes only `status === 'pending'`
(a mixed list); next steps appear on the zero-entity / lone-member / no-dataset
conditions and disappear when a condition or its capability is false;
`notFound()` on a null tenant; `InlineNotification` when a read returns null.
Gate (fast only): `pnpm --filter @bap/web` `lint`, `typecheck`, `test`,
`format:check`. No migration, no `test:integration`.

## Open questions

1. Upload-data next step target: `/<slug>/documents/new` (assumed, where data
   enters) versus `/<slug>/datasets`.
2. Role display: raw role string versus per-role i18n labels (assumed labels).

## Corrections (advisor-verified, 2026-09-17)

1. Hrefs: `/datasets` and `/documents` are top-level routes, not `[orgSlug]`
   children. `/datasets` selects the workspace via `useOrganizationSelection`,
   so the link carries no slug. The Documents tile links `/documents`, the
   Datasets tile links `/datasets`, and the upload-data next step links
   `/datasets`. Never link `/<slug>/datasets`, `/<slug>/documents` or
   `/<slug>/documents/new` (resolves open question 1).
2. Membership limit: import `organizationCreationConfiguration.membershipLimit`
   from `lib/auth/server.ts` (already exported, pinned by `server.test.ts`); do
   not extract a new `MEMBERSHIP_LIMIT` constant.
3. `auth.api.listMembers` returns `{ members, total }` where `total` is a
   separate count: pass `query: { limit: 1, organizationId }` and read `total`.
   `auth.api.listInvitations` returns a bare array of every status: count
   `status === 'pending'`.
4. i18n: the server-only page calls `createServerI18n()` once and uses its `t`,
   not `translate()` per key; tests use no `I18nProvider`. Role labels reuse
   `workspaces.list.roleOwner|roleAdmin|roleMember`, so the `landing` namespace
   adds no per-role labels (resolves open question 2).
5. `readDatasets` wraps `getDatasets` (the API has no limit parameter, so it
   reads the full scope-wide list under the resource JWT); accepted cost.
6. A `ClickableTile` `href` from a server parent is fine because the react
   facade is `'use client'`. The invitations deep link `?tab=invitations`
   matches the members view tab contract.
7. Docs and `icon-contract.test.tsx` reconcile against the current tree: units E
   and D already landed, so removing the landing throwaway marker leaves
   `/account` as the only temporary page.
8. Tests: `entities.test.ts` gains a `readDatasets` case; `page.test.tsx` mocks
   `next/navigation` (`notFound`), `next/headers`, `lib/auth/server` `getAuth`
   (`listMembers`, `listInvitations`), `lib/organizations/entities`
   (`readOrganizationAccess`, `readLegalEntities`, `readDatasets`) and
   `lib/organizations/resolver`, and includes a rejected-promise case read with
   `Promise.allSettled`.
