# Inbox Channels (Phase 1a)

**Date:** 2026-09-17

## Problem

After Phase 0 the only way into the Inbox is a person dragging a file onto the
page. A client's system that could push documents has no endpoint to push to,
because every write path is bound to a browser session
([ADR 0015](../../docs/adr/0015-inbox-intake-model.md)).
[ADR 0016](../../docs/adr/0016-channel-principal.md) decides the channel
principal; this spec delivers the principal and the first push channel, the
intake API. Email intake is a stacked follow-up with its own spec.

## Scope

- Migration `20260917.0001_inbox_channels.sql`: `app.inbox_channel`,
  `inbox_item.channel_id` and `origin`, `auth.inbox_channel_credential` and its
  definer functions, `app.role_is_channel()`, the policy edits, the `auth.user`
  CHECK, the `app.erase_user` guard.
- API: `resolveChannelAccess`, `receiveIntake`, the channel items route, channel
  CRUD and credential issue and revoke for owners.
- Web: the public intake route with the edge IP bucket, the channel settings
  page under `/inbox/channels` for API channels.
- Worker: nothing. `understand_inbox_item` stays synchronous as in Phase 0.
- Deferred to 1a-email (stacked PR, own spec): Mailgun webhook, the API email
  route, `split_email_item`, ClamAV, `app.record_blob_scan`, email channels in
  the settings page, the Caddy cap, `BAP_MAILGUN_WEBHOOK_SIGNING_KEY_FILE`,
  `BAP_INTAKE_DOMAIN`, `BAP_CLAMAV_HOST`, the worker payload union.
- Deferred to 1b: `poll_channels`, `app.list_due_channels()`, the scheduler
  policy, `sweep_orphan_blobs`, `inbox_rule` and auto-route as rule author,
  reply mail and `@bap/mail`, a per-organization quota setting.

## Design

Migration. `app.inbox_channel`: `id`, `organization_id`, `kind` (`email` or
`api`; the `channel_kind` vocabulary of `inbox_item` is reused), `name`,
`enabled`, `legal_entity_id` (composite FK, `ON DELETE SET NULL`), `hint_kind`,
`config jsonb` (non-secret only), `email_address` (null in 1a; stored plain
later because the owner must read it), `last_run_at`, `last_error` (a code,
never a message), `created_by`, `deleted_at`, `created_at`, `updated_at`,
`unique (id, organization_id)`. Policies: SELECT by organization; INSERT and
DELETE `app.role_is_owner()`; UPDATE `app.role_can_write()`. A channel is
soft-deleted (`enabled = false`, `deleted_at`), never removed while items point
at it. `app.inbox_item` gains `channel_id uuid` (composite FK to
`inbox_channel(id, organization_id)`, `ON DELETE RESTRICT`, null for uploads)
and `origin text` (credential display prefix). `auth.inbox_channel_credential`
as in ADR 0016; the REVOKE of the default `bap_auth` DML follows the CREATE.
`auth.issue_channel_credential(channel_id uuid, kind text)` filters the channel
by `organization_id` from the settings explicitly and asserts
`current_setting('bap.role', true) = 'owner'`;
`auth.revoke_channel_credential(credential_id uuid)` reads the same settings;
both are granted to `bap_api`.
`auth.resolve_channel_credential(secret_sha256 text)` is granted to `bap_auth`.
`app.role_is_channel()` beside `role_can_write()`, EXECUTE to `bap_api` and
`bap_reporting`. The five inbox INSERT policies become
`... AND (app.role_can_write() OR app.role_is_channel())` with the `created_by`
check outside the parentheses; `blob_update` is not changed.
`inbox_item_channel_update`: USING
`organization_id = current_setting('bap.organization_id', true) AND app.role_is_channel() AND status <> 'routed' AND decided_by_kind IS DISTINCT FROM 'user'`,
WITH CHECK the same plus
`AND document_id IS NULL AND dataset_id IS NULL AND partner_id IS NULL`. Every
non-inbox SELECT policy gains `AND NOT app.role_is_channel()`;
`audit_log_isolation` is split so a channel cannot read `app.audit_log` while
`record_audit` inserts keep working. Edits use `ALTER POLICY`, not drop and
create; the runner is transactional (`packages/db/src/migrations.ts`) and
rollback is forward-only by restore.
`ALTER TABLE auth."user" ADD CONSTRAINT user_id_not_channel_check CHECK (id NOT LIKE 'channel\_%')`
validates existing rows; `app.erase_user` raises on a `channel_%` subject.
`DATABASE_MIGRATION_COMPATIBILITY` becomes `20260917.0001`.

API. `resolveChannelAccess(request, organizationId, channelId)` in
`apps/api/src/channel-access.ts` accepts only a `channel_<uuid>` subject whose
uuid equals `channelId`, opens the tenant transaction as
`{ role: 'channel', userId: subject }` and selects the enabled channel; anything
else is 404. It returns `ChannelAccess`
`{ organizationId, channelId, subject }`, distinct from `TenantAccess`; there is
no channel capability. `receiveUpload` in
`apps/api/src/inbox/inbox-repository.ts` becomes
`receiveIntake(channelKind, channelId, payloadKind, origin, externalId)` with
`legalEntityIds: null` for channels and the channel's `legal_entity_id` and
`hint_kind` copied onto the item; the item lands `received`, or `discarded` on
an exact-hash duplicate, as in Phase 0.
`POST /v1/organizations/:organizationId/inbox/channels/:channelId/items` accepts
one multipart file or a JSON structured payload (`payload_kind` `file` or
`structured`, `external_id` required for structured) under a `ChannelAccess` or
a `TenantAccess` with `manageDocuments`, answers 202 with the item id and never
returns item content. Every other route requires `TenantAccess` and answers 403
to a `channel_` subject. Owners manage channels through `GET`, `POST` and
`PATCH /v1/organizations/:organizationId/inbox/channels[/:channelId]` and issue
or revoke credentials through `POST .../channels/:channelId/credentials` and
`DELETE .../credentials/:credentialId`, all under `manageOrganization`; the
issue response carries the plain secret once. `inboxItemSchema` gains
`channelId` and `origin`.

Web. `POST /api/intake/v1/items` checks the edge IP bucket (sign-up shape,
`docs/security.md`), reads the bearer, hashes it, calls
`auth.resolve_channel_credential` on the existing `bap_auth` pool, consumes the
bucket on a miss, and forwards to the API channel items route with a minted
channel JWT. `/inbox/channels` inside the product shell through `PageContainer`:
a `DataGrid` of API channels, create, issue and revoke a credential with the
show-once secret, enable and disable. Rail unchanged; `channels` is a child of
the reserved `inbox` segment.

## Security

The credential secret crosses one boundary once: from the issue response to the
owner's screen. The web never logs it, the API never sees it (only the web
hashes and resolves), and the credential row keeps a hash and a prefix.
Organization binding comes from the credential row and is re-checked by RLS on
the API side; the JWT carries no organization and the request payload is never
consulted. Logs carry operation, reason and ids; never the token, a filename or
a hash.

## Verification

- `packages/db` integration: migration applies; a channel context cannot read
  `app.audit_log`, `app.document`, `app.partner` or `app.dataset`, cannot insert
  into them or into `document_file`, cannot update a routed item or one decided
  by a user, cannot set a destination column; `bap_reporting` reads still work
  after the SELECT policy change; `app.erase_user` refuses a channel;
  `auth.user` refuses a `channel_` id; `bap_auth` has no direct DML on the
  credential table; two active credentials, third refused; revoke, resolve, and
  cross-organization resolve returning nothing.
- `apps/api` unit and integration: channel access (wrong subject, wrong channel,
  disabled channel, wrong organization all 404); intake under a channel JWT for
  file and structured; issue returns the secret once and never again; every
  non-intake route answers 403 to a channel subject.
- `apps/web` unit: unknown token 401, edge bucket after repeated misses, channel
  settings page and BFF mirrors.
- `pnpm check` locally; `pnpm test:integration` in CI.

## Open questions

None. `last_run_at` and `last_error` are written through a security definer
`app.record_channel_run(channel_id, error_code)` with EXECUTE to `bap_api`,
implemented with the first real puller (Phase 3), not in 1a.
