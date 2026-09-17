# Inbox Channels (Phase 1a)

**Date:** 2026-09-17

## Problem

After Phase 0 the only way into the Inbox is a person dragging a file onto the
page. An accountant who receives invoices by email still downloads and uploads
them by hand, and a client's system that could push documents has no endpoint to
push to. Nothing non-human can write, because every write path is bound to a
browser session ([ADR 0015](../../docs/adr/0015-inbox-intake-model.md)).
[ADR 0016](../../docs/adr/0016-channel-principal.md) defines the channel
principal; this spec delivers it with the two push channels, email-in and the
intake API, and the worker jobs they need.

## Scope

- Migration `20260917.0001_inbox_channels.sql`: `app.inbox_channel`,
  `inbox_item.channel_id` and `origin`, `auth.inbox_channel_credential` and its
  definer functions, `app.role_is_channel()`, the policy edits, the `auth.user`
  CHECK, the `app.erase_user` guard, `app.list_due_channels()`.
- API: `resolveChannelAccess`, `receiveIntake`, the two channel intake routes,
  channel and credential management for owners.
- Worker: `understand_inbox_item`, `split_email_item`, `poll_channels`
  (skeleton), `sweep_orphan_blobs`.
- Web: the public intake route, the Mailgun inbound route, the channel settings
  page under `/inbox/channels`.
- Infrastructure: the `clamav` service, the Caddy body cap for the inbound path,
  three configuration inputs.
- Not in scope, all Phase 1b or later: `inbox_rule` and auto-route as rule
  author, `inbox_routing_target`, `inbox_correction`, fingerprint duplicates,
  the Split action UI, ARES, any AI provider, the document versioning route,
  reply mail and `@bap/mail`, a per-organization quota setting, MCP
  `inbox.submit`, any real pull channel beyond the cron skeleton, an isolated
  parse process.

## Design

Migration. `app.inbox_channel`: `id`, `organization_id`, `kind` (`email` or
`api`; the `channel_kind` vocabulary of `inbox_item` is reused), `name`,
`enabled`, `legal_entity_id` (composite FK, `ON DELETE SET NULL`), `hint_kind`,
`config jsonb` (non-secret only), `email_address` (the display address for an
email channel), `last_run_at`, `last_error` (a code, never a message),
`created_by`, `deleted_at`, `created_at`, `updated_at`,
`unique (id, organization_id)`. Policies: SELECT by organization; INSERT and
DELETE `app.role_is_owner()`; UPDATE `app.role_can_write()`;
`inbox_channel_scheduler_select TO bap_owner USING (true)` for the definer. A
channel is soft-deleted (`enabled = false`, `deleted_at`), never removed while
items point at it. `app.inbox_item` gains `channel_id uuid` (composite FK to
`inbox_channel(id, organization_id)`, `ON DELETE RESTRICT`, null for uploads)
and `origin text` (sender address or credential display prefix).
`auth.inbox_channel_credential` as in ADR 0016, direct grants revoked;
`auth.issue_channel_credential(channel_id uuid, kind text)` and
`auth.revoke_channel_credential(credential_id uuid)` read `bap.organization_id`
and `bap.user_id` from the settings and are granted to `bap_api`;
`auth.resolve_channel_credential(secret_sha256 text)` is granted to `bap_auth`.
`app.role_is_channel()` beside `role_can_write()`; the six named policies gain
`OR app.role_is_channel()`; `inbox_item_channel_update` as in the ADR;
`ALTER TABLE auth."user" ADD CONSTRAINT user_id_not_channel_check CHECK (id NOT LIKE 'channel\_%')`;
`app.erase_user` raises on a `channel_%` subject; `app.list_due_channels()`
returns `(id, organization_id)` for enabled channels whose kind has a schedule
(none in 1a, so it returns zero rows). `DATABASE_MIGRATION_COMPATIBILITY`
becomes `20260917.0001`.

API. `resolveChannelAccess(request, organizationId, channelId)` in
`apps/api/src/channel-access.ts` accepts only a `channel_<uuid>` subject whose
uuid equals `channelId`, opens the tenant transaction as
`{ role: 'channel', userId: subject }` and selects the enabled channel; anything
else is 404. `receiveUpload` in `apps/api/src/inbox/inbox-repository.ts` becomes
`receiveIntake(channelKind, channelId, payloadKind, origin, externalId)` with
`legalEntityIds: null` for channels and the channel's `legal_entity_id` and
`hint_kind` copied onto the item.
`POST /v1/organizations/:organizationId/inbox/channels/:channelId/items` accepts
one multipart file or a JSON structured payload (`payload_kind` `file` or
`structured`, `external_id` required for structured) under a channel JWT.
`POST .../channels/:channelId/email` accepts the raw MIME stream, stores it at
position 1, `payload_kind = 'email'`, `external_id` = the Mailgun token. Both
answer 202 with the item id, enqueue `understand_inbox_item`, and never return
item content. Owners manage channels through `GET`, `POST` and
`PATCH /v1/organizations/:organizationId/inbox/channels[/:channelId]` and issue
or revoke credentials through `POST .../channels/:channelId/credentials` and
`DELETE .../credentials/:credentialId`, all under `manageOrganization`; the
issue response carries the plain secret once. `inboxItemSchema` gains
`channelId` and `origin`.

Worker. `understand_inbox_item` runs the sniff after commit for every channel
kind, including upload, replacing the synchronous Phase 0 sniff; the upload
response no longer carries a detected type, and the page refetches.
`split_email_item` parses the `.eml` with mailparser under the ADR 0016 caps,
sends each attachment to ClamAV (`BAP_CLAMAV_HOST`), records `blob.scan_status`,
and creates one child item per attachment with `parent_item_id`; an infected
attachment becomes a child item with `unprocessable_policy_rejected` and no
further parsing. `poll_channels` is a pg-boss cron tick that calls
`app.list_due_channels()` and enqueues per channel with `singletonKey`; 1a ships
the tick and the enqueue, no puller. `sweep_orphan_blobs` is a daily cron job
reading as `system_sweep` and reporting counts through the worker metrics;
deletion of orphans is a later decision.

Web. `POST /api/intake/v1/items` reads the bearer, hashes it, calls
`auth.resolve_channel_credential` on the existing `bap_auth` pool, consumes the
edge IP bucket on a miss, and forwards to the API channel items route with a
minted channel JWT. `POST /api/inbound/mailgun` verifies the signature and
window, resolves the recipient token, and streams `body-mime` to the API email
route. `/inbox/channels` inside the product shell through `PageContainer`: a
`DataGrid` of channels, create an email or API channel, show the address, issue
and revoke a credential with the show-once secret, enable and disable. Rail
unchanged; `channels` is a child of the reserved `inbox` segment.

Infrastructure. `clamav` in `compose.yaml` and `compose.production.yaml`: clamd
plus freshclam, `internet-egress` member for signature updates, non-root,
`read_only` with a signature volume, no host port; `scripts/verify-compose.mjs`
adds it to the egress allowlist and asserts no other service change.
`infrastructure/caddy/Caddyfile` gains a 30 MB `request_body` matcher for
`/api/inbound/*`. New inputs: `BAP_MAILGUN_WEBHOOK_SIGNING_KEY_FILE` (web),
`BAP_INTAKE_DOMAIN` (api, for the email address), `BAP_CLAMAV_HOST` (worker).

## Security

The credential secret crosses one boundary once: from the issue response to the
owner's screen. The web never logs it, the API never sees it (only the web
hashes and resolves), and the credential row keeps a hash and a prefix.
Organization binding comes from the credential row and is re-checked by RLS on
the API side; the JWT carries no organization and the request payload is never
consulted. The Mailgun signing key stays a mounted file in the web container.
Inbound bytes reach the blob volume through the API and never a provider. Logs
carry operation, reason and ids; never the token, the recipient address, the
sender, a filename or a hash. pg-boss payloads carry `organizationId` and
`channelId` or `userId` only. RLS proofs: a channel context cannot insert into
`app.document`, `app.partner` or `app.dataset`; cannot update a routed item, set
a destination column or overwrite `decided_by_kind = 'user'`; cannot insert
`document_file`; `app.erase_user` refuses it; `auth.user` refuses a `channel_`
id.

## Verification

- `packages/db` integration: migration applies; every RLS proof above; two
  active credentials, third refused; revoke, resolve, and cross-organization
  resolve returning nothing; `list_due_channels` readable only through the
  definer.
- `apps/api` unit and integration: channel access (wrong subject, wrong channel,
  disabled channel, wrong organization all 404); intake under a channel JWT for
  file and structured; email route stores position 1 and dedups on
  `external_id`; issue returns the secret once and never again; every non-intake
  route answers 403 to a channel subject; `runTenantJob` union and the
  disabled-channel throw; `split_email_item` caps and the infected path;
  `sweep_orphan_blobs` writes nothing.
- `apps/web` unit: signature verification vectors (valid, wrong key, expired
  window, malformed), replay of the same token, unknown recipient 406, edge
  bucket after repeated misses, channel settings page and BFF mirrors.
- `pnpm compose:verify`; `pnpm check` locally; `pnpm test:integration` in CI.

## Open questions

None. Two were settled on 2026-09-17:

- Non-inbox SELECT policies gain `AND NOT app.role_is_channel()` in this
  migration (every tenant table except `app.inbox_channel`, `app.inbox_item`,
  `app.inbox_item_file`, `app.inbox_item_extraction`, `app.inbox_event` and
  `app.blob`), so a channel context reads nothing it did not write, at the
  database level and not only at the API. Foreign key checks bypass row level
  security, so composite pins to legal entities and partners still validate.
- `last_run_at` and `last_error` are written through a security definer
  `app.record_channel_run(channel_id, error_code)` with EXECUTE to `bap_api`,
  implemented with the first real puller (Phase 3), not in 1a.
