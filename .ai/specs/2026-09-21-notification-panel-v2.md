# Notification panel v2 (Carbon notification pattern)

## Problem

v1 (`.ai/specs/2026-09-21-notification-inbox.md`, shipped) persists per-user
notifications and renders them as a bare list (title + date) in the header
`HeaderPanel`. It does not follow Carbon's notification-panel pattern: no unread
state, no per-item or bulk actions, no grouping, no body text, no status icons,
no "view all". This brings the panel up to that pattern without adding
`@carbon/ibm-products` (keeps the `@bap/design-system` facade boundary).

## Decisions (from Hleb)

- Full Tier-1 + Tier-2.
- Explicit read model: opening the panel no longer auto-marks read. The unread
  indicator persists until "Mark all read", a per-item read (row click), or the
  item is dismissed.
- Dismiss = hard delete of the row. Distinct from "Mark all read" (sets
  `read_at`, keeps rows).
- Emit points unchanged (only `member.joined`).

## Scope

Does:

- `body` text on notifications; status icon + severity per `kind`; unread left
  border; relative time; group-by-day headers (Today / Yesterday / date).
- Panel actions: header "Mark all read" + "Dismiss all"; per-row dismiss (x);
  row click navigates (href) and marks that row read; footer "View all".
- `/notifications` page (full list) built with the sanctioned `DataGrid` block.
- Widen the header panel (~16rem -> ~20rem).

Does not:

- Add `@carbon/ibm-products` or any new package.
- Add live push, retention/pruning, new emit sources, or a second locale.
- Emit outside the web (`bap_api`/worker still get no grant).

## Data (`@bap/db`, migration `20260922.0004_notification_panel.sql`)

- `ALTER TABLE auth.notification ADD COLUMN body text;`
- Reserve the `notifications` route slug: same guard +
  `DROP/ADD organization_slug_reserved_check` pattern as
  `20260922.0002_reserve_workspaces_route_slug.sql`, adding `'notifications'` to
  the value list (keep all existing values).
- Bump `DATABASE_MIGRATION_COMPATIBILITY` to `'20260922.0004'`.

`NotificationRow` gains `body: string | null`; `CreateNotificationInput` gains
`body?: string | null`. New functions (all scoped by `user_id = $1`):

```ts
export function markNotificationRead(pool, userId, id): Promise<number>; // set read_at where id and user_id and read_at is null
export function deleteNotification(pool, userId, id): Promise<number>; // delete where id and user_id
export function deleteAllNotifications(pool, userId): Promise<number>; // delete where user_id
```

Keep `createNotification` (now also writes `body`), `listNotifications`,
`countUnreadNotifications`, `markNotificationsRead` (all).

## Web

### Header panel

- `product-shell.tsx`: **remove** the auto-mark-on-open effect. Keep passing
  `notifications` + `unreadCount`. Badge stays `unreadCount + invitationCount`.
- `header-panels.tsx` `NotificationsPanel` rewrite to the pattern:
  - Header row: title + right-aligned "Mark all read" (disabled when
    `unreadCount === 0`) and "Dismiss all" (disabled when empty). Ghost buttons.
  - Keep the pinned invitation line when `invitationCount > 0`.
  - Group notifications by day with a small day header (Today / Yesterday /
    localized date), newest first.
  - Row: leading status icon (per `kind` -> severity), title (bold), `body`
    (muted, when present), relative time (`Intl.RelativeTimeFormat`); unread =
    colored left border. Trailing dismiss button (`Close` icon). When `href` is
    set the title area is a `next/link` that navigates and calls the per-item
    read action; a non-href row is plain.
  - Empty state when no invitations and no notifications.
  - Footer: "View all" -> `/notifications`.
- `header-panels.module.scss`: row layout, unread border, day header, widen the
  panel (`:global(.cds--header-panel)` ~20rem within this shell).

### `kind` -> severity map (one place, reused by panel + page)

`member.joined` -> success; `document.*` -> info; `system` -> info; unknown ->
info. Severity -> facade filled icon + token color.

### Server actions (`apps/web/src/lib/notifications/actions.ts`)

Add, mirroring the existing `markNotificationsReadAction` guards (session +
`emailVerified`, scope by `session.user.id`), zod-parsing a uuid where needed:

- `markNotificationReadAction(id)`
- `dismissNotificationAction(id)`
- `dismissAllNotificationsAction()` Keep `markNotificationsReadAction` (mark
  all). Each `router`-refreshable by the caller.

### `/notifications` page

- `app/(product)/notifications/page.tsx` (server): read `listNotifications`
  (all, higher limit) with the same try/catch; render inside the product shell
  via `PageContainer` (see `docs/product-pages.md`). Add `notifications` to the
  reserved-slug DB constraint (above) **and** the TS list
  `apps/web/src/lib/organizations/slug.ts` `reservedOrganizationSlugs` in the
  same change; update `docs/application-routes.md`.
- `notifications-view.tsx` (client): `DataGrid` block (never a hand-rolled
  DataTable). Columns: Title (+ body), kind/severity, date; `rowActions` =
  dismiss; `onRowClick` navigates to `href` when present. Reuses the server
  actions via `router.refresh()`.
- Not added to the left rail; reachable via the panel "View all" and direct
  link.

### i18n (`resources.ts`, literal keys only; owned by the panel lane)

Under `shell.notifications`: `markAllRead`, `dismissAll`, `dismiss`, `viewAll`,
`today`, `yesterday` (existing `title`, `empty`). New top-level `notifications`
block for the page: `title`, column headers, empty. The page lane references
these keys; the panel lane adds them (single writer of `resources.ts`).

## Design system (`@bap/design-system`)

Add filled status icons to the curated facade + `tokens.test.ts` list +
`icons.ts`: `CheckmarkFilled`, `InformationFilled`, `WarningFilled`,
`ErrorFilled`. (`Close` already present for dismiss.) Update
`apps/web/src/components/icon-contract.test.tsx` for any new decorative
callsites.

## Tests

- db: fake-pool asserts `user_id = $1` (and `id = $2` for by-id fns);
  integration asserts the reserved-slug constraint now rejects `notifications`
  and the ACL is unchanged.
- reserved slug parity test (DB constraint values ==
  `reservedOrganizationSlugs`) includes `notifications`.
- web: panel tests (mark all read, dismiss one, dismiss all, grouping headers,
  unread border present, no auto-mark on open, view-all link); actions tests;
  `/notifications` page renders rows in the DataGrid and dismiss works.
- design-system: facade + tokens for the 4 new icons; icon-contract updated.

## Lanes (waves; file-disjoint; up to 4 agents)

- Wave 1 (parallel): **A** = `@bap/db` (migration 0004, service fns, body,
  reserved-slug DB, compat, db tests). **D** = `@bap/design-system` facade icons
  (+ tokens test).
- Wave 2 (after A+D built; parallel): **B** = header panel + product-shell
  (remove auto-mark) + scss + server actions + i18n (owns `resources.ts`) +
  panel tests + icon-contract. **C** = `/notifications` page (`page.tsx`,
  `notifications-view.tsx` DataGrid) + reserved-slug TS list + route/docs + page
  test.
- Integration (orchestrator): gate, migrate live DB, rebuild+restart, self-
  screenshot, then showcase.

B and C are file-disjoint; only B writes `resources.ts` (keys listed above for C
to consume).

## Advisor-critical (Fable 5.1) revisions — folded, authoritative

Two pre-existing reds on this branch that a lane must absorb (else v2 gets
blamed):

- `packages/design-system/src/icons.test.tsx` `expectedNames` is missing
  `Settings` (added in 2971a52) -> red now. Lane D adds `Settings` + the 2 new
  icons here.
- `packages/db/src/documents.integration.test.ts:223-228` pins compat
  `'20260922.0002'` (4 literals) -> `pnpm test:integration` red. Lane A sets all
  four to `'20260922.0004'`.

Must-fix deltas:

1. **Reserved-slug parity is 3-legged** (all must change together): DB
   constraint text in `packages/db/src/postgres.integration.test.ts:~531` append
   `, 'notifications'::text` (A); `tests/fixtures/organization-slugs.json` add
   `{ "slug": "notifications", "valid": false }` (C); `slug.ts` + `slug.test.ts`
   literal list (C). Append `notifications` LAST, same order as the SQL
   constraint.
2. **Breadcrumbs**: add `notifications: 'Notifications'` to `moduleLabels` in
   `apps/web/src/components/shell/breadcrumb-trail.ts` + a
   `breadcrumb-trail.test.ts` case (C). Else it renders "Workspaces >
   notifications".
3. **Dismiss control**: NOT `Button renderIcon={Close} hasIconOnly` (banned by
   icon-contract). Use
   `IconButton kind="ghost" size="sm" label={t('shell.notifications.dismiss')}`
   with child `<Close aria-hidden="true" size={16} />` (B).
4. **Status icons**: render as literal JSX in an explicit `switch`
   (`<CheckmarkFilled aria-hidden="true" focusable="false" size={16} />`), never
   a variable tag `const Icon = map[...]`. Lives in the shared
   `apps/web/src/lib/notifications/severity.tsx` (D); the scanner only sees
   literal facade tag names.
5. **Only 2 filled icons** (`CheckmarkFilled`, `InformationFilled`) — the kind
   map yields success/info only; `WarningFilled`/`ErrorFilled` would be
   unreachable (facade "export only with a real call site").
6. **body is written** in the emit: `apps/web/src/lib/auth/server.ts`
   `createNotification({ ..., body: 'Joined as ' + member.role })` (or the real
   role field) + `server.test.ts` assertion (A owns this edit). Keeps `body`
   alive.
7. **by-id SQL** = `where user_id = $1 and id = $2`; `access.test.ts` asserts
   both fragments. Each by-id server action zod-parses `z.string().uuid()` and
   silently no-ops on a bad session (mirror `actions.ts:14-16`).
8. **Panel width** scoped: pass `className={styles.notificationsPanel}` to the
   notifications `HeaderPanel`; width lives on
   `.notificationsPanel:global(.cds--header-panel--expanded)`, never global
   `.cds--header-panel` (B).
9. **Row click** keeps the `Link` +
   `onClick={() => void markNotificationReadAction(id).then(() => router.refresh())}`
   (no preventDefault, no await before nav). Header buttons
   `void action().then(() => router.refresh())`. Add a "no auto-mark on open"
   panel test.
10. `/notifications` rail-active falls back to Workspaces (link-only page);
    accept + note the deviation in `docs/application-routes.md` (C). "Dismiss
    all"/"Mark all read" act on ALL rows (fns take no limit). `onRowClick`
    no-ops for null `href`.

### Corrected lanes (file-disjoint; each Wave-1 lane gates its OWN package only; orchestrator runs the web typecheck between waves)

Wave 1 (parallel):

- **A** = `packages/db`: migration `20260922.0004` (body col + reserve
  `notifications` slug w/ guard + append to constraint), `access.ts` (body on
  `NotificationRow`/`CreateNotificationInput`, `createNotification` writes body,
  new `markNotificationRead`/`deleteNotification`/`deleteAllNotifications` with
  `user_id=$1 and id=$2`, compat `'20260922.0004'`), `index.ts`,
  `access.test.ts`, `postgres.integration.test.ts` (constraint text),
  `documents.integration.test.ts` (compat x4); PLUS
  `apps/web/src/lib/notifications/actions.ts` (3 new actions + zod uuid) + its
  test, and `apps/web/src/lib/auth/server.ts` emit body + `server.test.ts`.
  Gate: `pnpm --filter @bap/db typecheck/test/build`. Do NOT run the web gate (D
  edits web concurrently).
- **D** = `packages/design-system` (icons.ts + icons.test.tsx incl `Settings`
  fix + tokens.test.ts, add `CheckmarkFilled`+`InformationFilled`); PLUS
  `apps/web/src/lib/notifications/severity.tsx` (explicit-switch severity
  component: icon + color class),
  `apps/web/src/components/icon-contract.test.tsx` (severity.tsx
  `reviewedImports` + `directCallsites`), `apps/web/src/i18n/resources.ts` (ALL
  keys, both blocks). Gate:
  `pnpm --filter @bap/design-system typecheck/test/build`. Do NOT run the web
  gate.

A/D web files are disjoint (A: actions.ts, server.ts; D: severity.tsx,
icon-contract.test.tsx, resources.ts).

Wave 2 (parallel, after A+D built + orchestrator web-typecheck green):

- **B** = `header-panels.tsx` (panel rewrite, imports severity from D + actions
  from A), `header-panels.module.scss`, `product-shell.tsx` (remove auto-mark),
  `product-shell.test.tsx` (mock new actions + panel tests),
  `icon-contract.test.tsx` (header-panels `Close` callsite + `reviewedImports`).
- **C** = `app/(product)/notifications/page.tsx`, `notifications-view.tsx`
  (DataGrid, text `rowActions` dismiss, `onRowClick`), `page.test.tsx`,
  `slug.ts`, `slug.test.ts`, `tests/fixtures/organization-slugs.json`,
  `breadcrumb-trail.ts` + test, `docs/application-routes.md`. C imports NO
  facade icon (uses D's severity component + text RowAction), so it never
  touches `icon-contract.test.tsx`.

Safeguards: before live-migrate,
`select 1 from auth.organization where slug='notifications'` returns nothing;
end of Wave 1 `pnpm --filter @bap/design-system test` + `pnpm test:integration`
green; migrate before restart; pass `BAP_PUBLIC_ORIGIN` on recreate.
