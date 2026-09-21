# Notification inbox (v1)

## Problem

The header notification bell and panel are a facade over one number:
`invitationCount = auth.api.listUserInvitations().length`
(`apps/web/src/app/(product)/layout.tsx`). There is no persistent per-user
notification store anywhere in the codebase, so no code path can raise a
notification and nothing but pending invitations can ever appear in the panel.

## Scope

Add a real, persistent per-user notification inbox, surfaced in the existing
header `HeaderPanel`. Any server code path raises one by calling
`createNotification(pool, { userId, kind, title, href })`. The badge shows
unread notifications plus pending invitations. One real emit point ships: when
an invitation is accepted, the inviter is notified that the member joined.

Does not:

- Add live push (SSE/websocket/poll). v1 refreshes on panel open.
- Add a `@carbon/ibm-products` dependency or any new package. Uses the existing
  `HeaderPanel` with a list of rows.
- Fold invitations into the table. Pending invitations stay a live pinned line
  read from Better Auth; they are never persisted as notification rows.
- Add a `/notifications` page, pagination, per-kind icons, retention/pruning, a
  `body` column, or notification emission from `apps/api` or the worker.
- Use RLS. The table lives in the `auth` schema, which has no RLS; every query
  is scoped by `user_id = $1`, exactly like `auth.session`.

## Design

### Data (`@bap/db`)

Migration `packages/db/drizzle/20260922.0003_notifications.sql` (id must sort
after the applied `20260922.0002`):

```sql
CREATE TABLE IF NOT EXISTS auth.notification (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES auth."user"(id) ON DELETE CASCADE,
  kind text NOT NULL,
  title text NOT NULL,
  href text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_kind_check CHECK (kind <> ''),
  CONSTRAINT notification_title_check CHECK (title <> '')
);
CREATE INDEX IF NOT EXISTS notification_user_created_idx
  ON auth.notification (user_id, created_at DESC);
```

No RLS, no GRANT/REVOKE: default privileges in `auth` give `bap_auth` DML and
`bap_backup` SELECT. `bap_api`/`bap_reporting` get nothing (no external emitter
in v1).

Service in `packages/db/src/access.ts` (exported from `index.ts`), scoped by
`user_id = $1` in every statement, following the `listUserSessions` pattern:

```ts
export interface NotificationRow {
  id: string;
  userId: string;
  kind: string;
  title: string;
  href: string | null;
  readAt: Date | null;
  createdAt: Date;
}
export interface CreateNotificationInput {
  userId: string;
  kind: string;
  title: string;
  href?: string | null;
}
export function createNotification(
  pool: Pool,
  input: CreateNotificationInput,
): Promise<void>;
export function listNotifications(
  pool: Pool,
  userId: string,
  limit?: number,
): Promise<NotificationRow[]>; // default limit 20
export function countUnreadNotifications(
  pool: Pool,
  userId: string,
): Promise<number>;
export function markNotificationsRead(
  pool: Pool,
  userId: string,
): Promise<number>; // marks all unread for the user
```

Bump `DATABASE_MIGRATION_COMPATIBILITY` (`access.ts`) to `'20260922.0003'` in
the same change. Migrate the live DB before restarting api/reporting/worker,
else `/ready` returns 503.

### Web

- `layout.tsx`: keep `session.user.id` (today it narrows to `{ email, name }`).
  Read `listNotifications(await getAuthPool(), userId)` and
  `countUnreadNotifications(...)` in the same `try/catch` style as
  `invitationCount`, defaulting to `[]`/`0`. Pass `notifications` and
  `unreadCount` to `ProductShell`.
- `product-shell.tsx`: badge count = `unreadCount + invitationCount`. Pass
  `notifications` to `NotificationsPanel`.
- `header-panels.tsx` `NotificationsPanel`: render the pinned invitation line
  (unchanged) plus a list of notification rows (title, relative/absolute time,
  optional `href` link). On open (`expanded` effect, guarded by
  `unreadCount > 0`) call the mark-read action then `router.refresh()`.
- New server action `markNotificationsReadAction` in
  `apps/web/src/lib/notifications/actions.ts`: `'use server'`, `getAuth()` +
  `headers()` + session + `emailVerified === true`, then
  `markNotificationsRead(await getAuthPool(), session.user.id)`. Mirrors
  `account/security/actions.ts`.
- i18n: literal keys only under `shell.notifications` in `resources.ts`
  (`completeness.test.ts` matches literal `t('a.b')`).

### Emit point

In `createAfterAcceptInvitationHook` (`apps/web/src/lib/auth/server.ts`), after
a successful accept, call
`createNotification(pool, { userId: invitation.inviterId, kind: 'member.joined', title: '<user.name> joined <organization.name>', href: '/<organization.slug>/members' })`
wrapped in `.catch(() => undefined)` like `applyInvitationEntityScope`. Covers
both accept surfaces through the one hook.

## Tests

- `packages/db/src/access.test.ts` (fake-pool): each of the four functions
  issues SQL containing `user_id = $1`.
- `packages/db/src/postgres.integration.test.ts`: `auth.notification` ACL is
  `bap_auth` DML + `bap_backup` SELECT + `bap_owner` ALL (default privileges).
- `apps/web/src/lib/auth/server.test.ts`: accept hook creates a notification for
  `invitation.inviterId` and swallows a failure.
- `apps/web/src/components/shell/product-shell.test.tsx`: badge = unread +
  invitations; panel renders notification rows.

## Follow-ups (out of scope, noted)

- Grant `INSERT ON auth.notification TO bap_api` when the API/worker needs to
  emit.
- Retention/pruning beyond N rows per user.
- `/notifications` page, live updates, per-kind icons, second-locale titles
  (stored `title` is English; only `en-US` exists today).
