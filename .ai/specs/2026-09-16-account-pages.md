# Account Pages in Carbon

**Date:** 2026-09-16

## Problem

`/account` is still the throwaway page: plain HTML, inline `<form>`s, one status
line, sign-out, change-password and delete-account all stacked with no layout.
The `/access` diagnostic sits on its own rail entry. Profile edit, password
change, delete, two-factor enrolment, session listing and preferences are all
real Better Auth routes plus existing cookies, so this becomes four Carbon pages
under `/account` inside `PageContainer`, with one small `@bap/db` read accessor.

## Scope

- `/account` (profile): heading; Profile section (name editable via
  `authClient.updateUser`, email read-only, initials avatar as styled initials
  in a Carbon `Tag`, no upload); Workspaces section (a `DataGrid` of
  `listWorkspaceMemberships` rows with role, server-read); Danger zone (Delete
  account in a `danger` `Modal`, password field, maps the sole-owner and
  freshness errors to inline notifications). Delete logic moves off
  `account-actions.tsx`.
- `/account/security`: Password section (current, new, confirm,
  `revokeOtherSessions` checkbox, logic moved from `account-actions.tsx`);
  Two-factor section (status from session `user.twoFactorEnabled`; Enable in a
  multi-step Modal password -> show otpauth URI and secret -> verify code ->
  backup codes with copy -> done; Disable password Modal; Regenerate backup
  codes password Modal); Sessions section (`DataGrid` from the new accessor with
  created, last active, expires, IP, shortened user agent, current row marked;
  row action Revoke; toolbar Sign out other sessions).
- `/account/preferences`: Theme `RadioButtonGroup` (light/dark/system) writing
  `bap_theme`, Rail pinned by default `Toggle` writing `bap_rail`. Nothing else.
- `/account/access`: the `/access` page content moved unchanged in behavior;
  `/access` becomes a redirect; Access removed from the rail.
- Header `AccountPanel`: keep the theme radio and sign out, repoint its links to
  the three new routes (text only).
- Out of scope (item 8): email change, avatar upload, passkeys, language
  control, notification preferences, a tokens page. No new migration.

## Design

- Routes. `account/page.tsx` (server: `getAuth().api.getSession`, then
  `listWorkspaceMemberships(getAuthPool(), userId)`; passes name, email,
  memberships) + `account-view.tsx` (client). `account/security/page.tsx`
  (server: `listUserSessions`, current session id and `twoFactorEnabled` from
  the session) + `security-view.tsx`. `account/preferences/page.tsx` (server:
  `readThemeMode`, `readRailPinned`) + `preferences-view.tsx`.
  `account/access/page.tsx` (moved verbatim from `access/page.tsx`, keeps its
  `access.*` i18n) + its moved test. `access/page.tsx` becomes a server
  component that calls `redirect('/account/access')` (chosen over a
  `next.config` rule: stays in the group, keeps the post-sign-in `/access`
  landing working, is unit-testable with mocked `next/navigation`). Each route
  gets a `page.test.tsx`. Delete `account-actions.tsx` and `account-actions`
  reference; move its password and delete logic into the views.
- Transport (client `authClient`, matches unit E/D): `updateUser({ name })`,
  `changePassword({ currentPassword, newPassword, revokeOtherSessions })`,
  `deleteUser({ password })`, `twoFactor.enable({ password })` (returns
  `totpURI` + `backupCodes`, `twoFactorEnabled` stays false),
  `twoFactor.verifyTotp({ code })` (flips it true),
  `twoFactor.disable({ password })`,
  `twoFactor.generateBackupCodes({ password })`, `revokeOtherSessions()` (no
  freshness needed). `client.ts` already registers `organizationClient()` and
  `twoFactorClient()`; no change. Client is chosen so each modal surfaces the
  code and stays open on failure.
- Revoke server action (token never reaches the browser): `security/actions.ts`
  `revokeSessionAction(sessionId: string): Promise<{ ok: boolean }>` reads the
  caller session, `findUserSessionToken(getAuthPool(), userId, sessionId)`, and
  on a hit calls `auth.api.revokeSession({ body: { token }, headers })`. A miss
  returns `{ ok: false }`; the id is only ever the caller's own row.
- Accessors (`packages/db/src/access.ts`, pool role `bap_auth`):
  `listUserSessions(pool, userId)` ->
  `select id, created_at, updated_at, expires_at, ip_address, user_agent from auth.session where user_id = $1 order by updated_at desc`
  (return type omits `token`); `findUserSessionToken(pool, userId, sessionId)`
  -> `select token from auth.session where id = $1 and user_id = $2` ->
  `string | null`.
- i18n: one new `account` namespace, keys sorted, groups `profile`,
  `workspaces`, `delete`, `password`, `twoFactor`, `sessions`, `preferences`;
  role labels reuse `workspaces.list.role*`; the `access.*` namespace is kept
  untouched for the moved diagnostic.
- QR: no QR renderer exists (`grep qrcode` in `pnpm-lock.yaml` and the manifests
  is empty). The enrolment modal shows the `totpURI` and the secret as copyable
  text only; adding a dependency is out of scope.
- Shell and docs: `product-navigation.ts` drops the `/access` `railDestination`;
  `breadcrumb-trail.ts` adds
  `childLabels.account = { security, preferences, access }` and drops the
  now-unused top-level `access` module label; `global-search.tsx` `stubResults`
  drops the `/access` entry; `product-shell.test.tsx` swaps its `/access`
  navigation fixture and the rail assertion; `header-panels.tsx` `AccountPanel`
  links repoint; `DESIGN.md:40-48` drops Access from the rail sentence and
  removes the account page from the temporary exception;
  `docs/application-routes.md` updates the rail list, the `/account` row (no
  longer temporary), the `/access` row (redirect), and adds the three nested
  rows; `icon-contract.test.tsx` drops the `account/page.tsx` and
  `account-actions.tsx` `throwawayPages` entries and repoints the access page
  path to `account/access/page.tsx`.

### Error mapping (all keep the modal open)

| Call             | Code                                                | UI                                                |
| ---------------- | --------------------------------------------------- | ------------------------------------------------- |
| `deleteUser`     | `INVALID_PASSWORD` / `CREDENTIAL_ACCOUNT_NOT_FOUND` | inline on the password field (see correction 1)   |
| `deleteUser`     | `ACCOUNT_HAS_SOLE_OWNED_ORGANIZATIONS`              | inline notification in the modal                  |
| `changePassword` | invalid current password                            | inline on the current-password field              |
| `twoFactor.*`    | invalid password                                    | inline on the modal password field                |
| `verifyTotp`     | invalid code                                        | inline on the code field                          |
| any              | HTTP 429 (rate limit 3/min)                         | inline "too many attempts, try again in a minute" |
| any other non-ok | generic toast                                       |

## Security

Session tokens never leave the server: `listUserSessions` return type has no
`token`; the browser sends only a session `id`, which `findUserSessionToken`
resolves under the caller's `user_id` before `revokeSession`. Passwords are
never logged and travel only in mutation bodies. `deleteUser`,
`revokeSession`/`revokeOtherSessions` and every `two-factor/*` endpoint are
password-gated and rate-limited 3/min in `authRateLimitRules`; the delete and
2FA modals surface a 429 as the inline message above rather than retrying.
`bap_auth` already holds `SELECT` on `auth.session` (grant at
`20260828.0001_auth_and_roles.sql:139`), so the accessor needs no migration.

## Verification

Per-route `page.test.tsx` inside `I18nProvider`/`ToastProvider` with
`authClient`, `next/navigation` and the accessors stubbed: profile name edit
(calls `updateUser`, refresh); delete modal maps sole-owner and
`SESSION_NOT_FRESH` inline; password change (with `revokeOtherSessions`); 2FA
enable flow across steps; disable; regenerate backup codes; sessions list
renders and marks the current row, Revoke calls the action, Sign out others
calls `revokeOtherSessions`; preferences write `bap_theme` and `bap_rail`;
access page renders; `/access` redirects to `/account/access`. `access.test.ts`
covers both accessors (no token in the list type);
`postgres.integration.test.ts` adds one assertion that `bap_auth` can `SELECT`
`auth.session` (no new grant). Breadcrumb and `product-shell` rail tests
updated. Gate (fast): `pnpm --filter @bap/db test`, then
`pnpm --filter @bap/web` `lint`, `typecheck`, `test`, `format:check`; run
`pnpm test:integration` for the accessor grant.

## Corrections (2026-09-17, advisor-verified against Better Auth 1.7.4)

1. Delete account: `delete-user` uses `sensitiveSessionMiddleware`; with a
   password in the body there is no freshness check. Reachable codes:
   `INVALID_PASSWORD` 400 (inline on the password field),
   `CREDENTIAL_ACCOUNT_NOT_FOUND`, and `ACCOUNT_HAS_SOLE_OWNED_ORGANIZATIONS`
   403 (inline notification in the modal). The `SESSION_NOT_FRESH` row and the
   sign-in link are dropped.
2. Security text: `authRateLimitRules` cover `/two-factor/*` only (3/min);
   `delete-user`, `change-password`, `update-user`, `revoke-session` and
   `revoke-other-sessions` fall under the global 100/min. The revoke endpoints
   take no password. The 429 inline message applies to the 2FA modals.
3. Session rotation: `verify-totp`, `disable`, and `changePassword` with
   `revokeOtherSessions` create a new session and delete the current token.
   After each success the view calls `router.refresh()` and the server
   re-derives the current session id.
4. Hide Revoke on the current session row: `revoke-session` deletes the token
   without clearing the cookie, so the next request is signed out.
5. ESLint: `bap/product-page-container` flags the redirect-only
   `(product)/access/page.tsx`, so it is added to the ignores in
   `packages/eslint-config/next.mjs`; the `src/app/(product)/account/**`
   exceptions (both places) are removed so the new account pages are linted.
6. `icon-contract.test.tsx`: the account entries move out of `throwawayPages`
   and the `intentionalPlainAccountSources` block is removed; the access icon
   list is re-keyed to `account/access/page.tsx`. Copy affordance uses the
   Carbon `CodeSnippet`/`CopyButton` from `@bap/design-system/react` (no Copy
   icon in the facade); account pages import no facade icons.
7. Rail preference: `ShellChrome` seeds `useState(railPinned)` once and adds a
   prop-sync effect so the preferences toggle applies live. Theme also calls
   `useThemeMode().setMode` alongside the cookie write.
8. Error codes: `change-password` wrong current is `INVALID_PASSWORD` 400 plus
   `PASSWORD_TOO_SHORT`/`PASSWORD_TOO_LONG`; `verify-totp` wrong code is
   `INVALID_CODE` 401; 2FA wrong password is `INVALID_PASSWORD` 400; enable
   leaves `twoFactorEnabled` false until verify; `generate-backup-codes` returns
   `{ status, backupCodes }`.
9. Docs also updated: `docs/authentication.md` (account section and the "1.7.3"
   mention -> 1.7.4), `docs/development.md`, `docs/testing.md`,
   `docs/security.md`, `docs/product-pages.md`, `docs/application-routes.md`.
10. Integration test already pins `bap_auth` DML on auth tables (the disposable
    default-privilege probe covers `auth.session`), so no new assertion is
    added. The fast gate adds `pnpm --filter @bap/web build`.

## Open questions

1. Delete flow is a single delete attempt; there is no freshness prompt (see
   correction 1).
2. Exact Better Auth codes are confirmed against 1.7.4 (see correction 8); the
   table maps by field regardless.
