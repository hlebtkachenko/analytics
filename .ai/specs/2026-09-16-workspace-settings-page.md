# Workspace Settings Page in Carbon

**Date:** 2026-09-16

## Problem

`/[orgSlug]/settings` is still the throwaway milestone-2 page: plain HTML, one
inline `<form>`, a `?result=success|error` line, a bare denial paragraph for
non-owners, no way to leave a workspace, and every update failure collapsed to
one message. Organization update and member leave are real Better Auth routes,
so this becomes a Carbon page like the entities and members pages, with no
backend work.

## Scope

- Replace `.../settings/page.tsx` with a Carbon page in `PageContainer`: a
  workspace-name heading, then two sections.
- General section: a Carbon `Form` with Name and Slug (`TextInput`, slug
  live-validated with `organizationSlugSchema` + `normalizeOrganizationSlug` and
  the URL preview helper exactly as unit B's `workspace-form.tsx`). Editable
  only with `manageOrganization`; otherwise both fields render `readOnly`
  (chosen over a definition list to keep one layout and the preview), no save,
  no denial paragraph. Save disabled while the slug is invalid; inline errors
  for slug taken and invalid slug; success toast.
- After a successful slug change: `router.push('/<newSlug>/settings')` then
  `router.refresh()`, so the `[orgSlug]` layout re-runs
  `resolveOrganizationRouteForRequest` and `ActiveOrganization` re-publishes
  `{name, slug}` into the `useActiveOrganization` context read by the
  breadcrumb, rail hrefs, and `SwitcherPanel` active label.
- Danger zone (every role): a "Leave workspace" button opening a `danger`
  `Modal`; on success navigate to `/organizations` with a toast; on the
  sole-owner error show the mapped i18n string as an `InlineNotification`, modal
  left open.
- Drop the throwaway marker; correct the throwaway-page counts (after units E
  and D only the `/[orgSlug]` landing remains temporary, plus `/account`) and
  the settings route row. No deletion UI and no text mentioning deletion
  anywhere.
- Out of scope: every other `[orgSlug]` page; ownership transfer; any new API,
  BFF, contract, migration, or icon.

## Design

Files modified: `.../settings/page.tsx` (server component: resolve tenant via
`resolveOrganizationRouteForRequest`, read `manageOrganization` via
`readOrganizationAccess`, pass `id`, `name`, `slug`, `manageOrganization` to the
view inside `PageContainer`), its `page.test.tsx`; `lib/auth/client.ts` (add
`organizationClient()` if unit E has not); `i18n/resources.ts`;
`lib/organizations/actions.ts` and `actions.test.ts` (delete
`updateOrganizationAction`); the `/organizations` `?result` toast bridge (unit
B) plus one marker; `components/icon-contract.test.tsx` (remove the settings
`throwawayPages` entry); and the throwaway count and settings row across
`DESIGN.md`, `ARCHITECTURE.md`, and `docs/` (`application-routes`,
`authentication`, `security`, `testing`). Created:
`.../settings/settings-view.tsx` (client child owning the Form, the leave Modal,
and toasts).

- Transport: client `authClient.organization.update` / `.leave`, not
  `updateOrganizationAction`, because that action redirects through `resultPath`
  and collapses slug-taken, invalid-slug, and every failure to one `error`
  marker, so it cannot keep a field-level error distinct or the leave modal
  open. Matches unit E's `authClient.organization.*` decision; both share
  `organizationClient()`.
- Capabilities: `manageOrganization` reaches the view from the server component
  (`readOrganizationAccess`); the `[orgSlug]` layout provides only name, role,
  slug. Better Auth re-checks `organization:update` per role statement (ADR 0011
  grants it to the owner alone).
- `update` needs `organizationId` in the body (`organizationIdRequiredPaths`
  enforces it), so the view sends the server-provided `id`. `leave` is neither
  disabled nor listed there; its native `{ organizationId }` body and sole-owner
  guard suffice, so `server.ts`/`contract.ts` need no change;
  `/organization/ delete` stays disabled and is never referenced.
- Validation and error mapping: slug validated live with
  `organizationSlugSchema`, then again by Better Auth's slug hook and route
  (name `trim().min(1)`). Update returns `ORGANIZATION_SLUG_ALREADY_TAKEN` (the
  update route's code, not create's `ORGANIZATION_ALREADY_EXISTS`) -> inline
  Slug error; a client-rejected slug -> inline invalid text; any other non-ok ->
  toast; all keep the form. Leave
  `YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER` -> the
  `settings.leave.lastOwner` `InlineNotification`, else a toast; modal kept.
- i18n: one new `settings` namespace, keys sorted, groups `general` (labels, URL
  preview, slugInvalid, slugTaken, save, saveSuccess/Failure) and `leave`
  (title, body, confirm, cancel, lastOwner, failure, leftToast); leave pushes
  `/organizations?result=workspace-left`, adding one marker to unit B's bridge.
- Orphan cleanup is a plain deletion in the commit: delete
  `updateOrganizationAction` and its `actions.test.ts` cases; once unit E has
  removed the member scoped actions on this branch, the now-unreferenced
  scoped-action helpers in `action-support.ts` (`resolveActionOrganization`,
  `runScopedAction`, `ScopedAction`, `ActionOrganization`) go too, keeping
  `formValue`, `resultPath`, `organizationPath`, `ActionResult`.

## Security

No browser id selects a tenant: `resolveOrganizationRouteForRequest` maps the
route slug server-side, and the id passed to `update`/`leave` is that resolved
id, which Better Auth re-checks against the caller's membership and role before
mutating. `manageOrganization` only chooses which controls render; the API is
the boundary. The id travels only in the mutation body, never in a query or a
log.

## Verification

`page.test.tsx` renders the view inside `I18nProvider` and `ToastProvider` with
`authClient.organization` and `next/navigation` stubbed, covering: owner edits
name and slug, save calls `update`, and a slug change pushes
`/<newSlug>/settings` then refreshes; a member sees `readOnly` fields with no
editing controls; a slug-taken update shows the inline Slug error, form kept, no
toast; leave success pushes `/organizations`; the sole-owner leave error shows
the `InlineNotification`, modal kept; the load renders. Gate (fast only):
`pnpm --filter @bap/design-system test`, then `pnpm --filter @bap/web` `lint`,
`typecheck`, `test`, `build`.

## Open questions

1. Leave-success toast: reuse the `/organizations` `?result=` bridge with a new
   `workspace-left` marker (assumed), or fire it client-side before
   `router.push` and accept it may not render.
2. Read-only rendering: `readOnly` `TextInput`s (assumed) or a definition list.

## Corrections (2026-09-17, advisor-verified, folded from build-plan Unit D)

1. Server slug validation on update: the before-hook validated only
   `/organization/create`. Extend `createAuthBeforeHook` (`lib/auth/server.ts`)
   with an `/organization/update` branch that normalizes `body.data.slug` with
   `normalizeOrganizationSlug` and validates it with `organizationSlugSchema`
   (reserved list included), mirroring the create branch, plus one
   `server.test.ts` case. The client also normalizes and validates; the database
   uniqueness check stays the backstop mapping to a generic toast.
2. Name is client-trimmed; Better Auth's update schema is `z.string().min(1)`.
3. `router.refresh()` runs after every successful save so a name-only save still
   refreshes `ActiveOrganization` (breadcrumb, header title, switcher fallback);
   a slug change also `router.push('/<newSlug>/settings')`.
4. Open question 1 resolved: reuse the `/organizations` `?result=` bridge; the
   `workspace-left` toast key lives under `workspaces.*` (the `toastByResult`
   map in `workspace-list.tsx` renders `t(toast.key)`). Add one `toastByResult`
   entry and one `workspaces` key; the `ActionResult` union is unchanged.
5. Orphans after unit E: delete `updateOrganizationAction`,
   `resolveActionOrganization`, `invalidScopedActionPath`, and the `'success'`
   member of `ActionResult`, plus their `actions.test.ts` and settings
   `page.test.tsx` cases.
6. Bodies: `update { organizationId, data: { name, slug } }`, slug collision
   `ORGANIZATION_SLUG_ALREADY_TAKEN`; `leave { organizationId }`, sole-owner
   code `YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER`.
7. `readOrganizationAccess` returning `null` renders read-only (fail closed),
   with a test.
8. Docs: temporary `[orgSlug]` page counts become singular (only the landing
   remains, plus `/account`); update `docs/authentication.md` scoped-action and
   final-owner paragraphs, `docs/security.md` server-action trust-boundary
   lines, `docs/testing.md` mentions, `docs/application-routes.md` settings row,
   and drop the settings entry from `icon-contract.test.tsx`.
9. Open question 2 resolved: read-only rendering uses `readOnly` `TextInput`s.
