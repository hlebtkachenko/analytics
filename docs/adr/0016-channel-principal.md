# ADR 0016: Channel Principal

- Status: accepted
- Date: 2026-09-17

## Context

[ADR 0015](0015-inbox-intake-model.md) made the Inbox the single intake boundary
and deferred one prerequisite: a non-human principal for every channel other
than manual upload. Today no non-human actor can write tenant data.

- Every resource JWT is minted from a verified browser session:
  `prepareApplicationCall` in `apps/web/src/lib/auth/bff.ts` signs
  `{ iat, sub: session.user.id }` and nothing else, and `/token` is in
  `disabledAuthPaths` (`apps/web/src/lib/auth/contract.ts`).
- The API resolves every request through `resolveTenantAccess`
  (`apps/api/src/tenant-access.ts`), which requires a verified-email membership
  with a role of `owner`, `admin` or `member` and answers 403 otherwise.
- The worker fails any job whose `userId` is not a live write-role member
  (`runTenantJob` in `apps/api/src/worker/job-context.ts`), and
  `subjectIdentifierSchema` there allows only `[A-Za-z0-9_-]`.
- Every tenant INSERT policy requires
  `created_by = current_setting('bap.user_id')` and `app.role_can_write()`
  (`packages/db/drizzle/20260914.0002_documents.sql:622-627`,
  `packages/db/drizzle/20260916.0001_inbox.sql:375-380`), and
  `app.role_can_write()` is `bap.role IN ('owner', 'admin')`
  (`packages/db/drizzle/20260910.0001_legal_entities.sql:75-82`).

An email webhook, an API token or a bank poll has no user.
`docs/authentication.md` already says that API keys and service identities need
a separate policy and that a human session JWT must never be reused as a service
identity. This record is that policy. It was reviewed at the critical tier
because it adds a principal that writes tenant data and edits row level
security.

## Decision

### Principal

A channel is a principal of its own, expressed with the settings that already
exist and nothing new in the database role set.

- `bap.role = 'channel'` and `bap.user_id = 'channel_<uuid>'`, where the uuid is
  `app.inbox_channel.id`. No `auth.user` row, no new setting, no new database
  role.
- `app.role_is_channel()` is a new STABLE, SECURITY INVOKER function beside
  `app.role_can_write()` and `app.role_is_owner()`. `app.role_can_write()` is
  not changed, so a channel is denied on every table by construction; a policy
  admits a channel only by naming `app.role_is_channel()`.
- Exactly six policies opt in with `OR app.role_is_channel()`: `blob_insert`,
  `inbox_item_insert`, `inbox_item_file_insert`, `inbox_item_extraction_insert`,
  `inbox_event_insert` and `blob_update` (the worker records `scan_status`).
  `document_file_insert` and every `document`, `partner`, `dataset` and
  `legal_entity` policy stay as they are.
- One new policy, `inbox_item_channel_update`:
  `USING (organization_id = current_setting('bap.organization_id', true) AND app.role_is_channel() AND status <> 'routed')`,
  `WITH CHECK (organization_id matches AND document_id IS NULL AND dataset_id IS NULL AND partner_id IS NULL AND decided_by_kind IS DISTINCT FROM 'user')`.
  A channel can move its item through `received`, `queued`, `processing`,
  `needs_review` and `failed`; it can never route, un-route or overwrite a
  person's decision.
- The subject uses an underscore, `channel_<uuid>`, because
  `subjectIdentifierSchema` forbids `:` and because it matches the
  `erased_<uuid>` tombstone convention. A CHECK on `auth.user`
  (`id NOT LIKE 'channel\_%'`) keeps the namespace disjoint, and
  `app.erase_user` refuses a `channel_%` subject, so a channel is never
  tombstoned; `audit_log.user_id` keeps `channel_<uuid>` forever.
- `TenantRole` in `packages/db/src/tenant.ts` widens to
  `'owner' | 'admin' | 'member' | 'channel'`. `tenant-access.ts` is untouched; a
  sibling `resolveChannelAccess` accepts only a `channel_` subject, opens the
  tenant transaction as `{ role: 'channel', userId: subject }` and selects
  `app.inbox_channel` where `id` is the subject's uuid and `enabled`; no row
  means 404.
- The worker payload becomes a union: `{ organizationId, userId }` or
  `{ organizationId, channelId }`. `runTenantJob` branches on it; the channel
  branch re-reads the channel at dequeue and throws when it is missing or
  disabled, exactly as a revoked membership fails a user job today.

### Token

An API channel authenticates with a credential that lives in `auth`, never in a
tenant table.

- `auth.inbox_channel_credential`: `id`, `channel_id`, `organization_id`, `kind`
  (`api_token` or `email_address`), `secret_sha256`, `display_prefix`,
  `created_by`, `created_at`, `revoked_at`. Direct table grants are revoked from
  `bap_auth` and `bap_api`; three `SECURITY DEFINER` functions owned by
  `bap_owner` with a fixed search path are the only surface, following
  `auth.resolve_membership`.
- `auth.issue_channel_credential(channel_id, kind)` and
  `auth.revoke_channel_credential(credential_id)` take the organization and the
  acting subject from the transaction settings, never as arguments, so they run
  only inside a tenant transaction; EXECUTE goes to `bap_api`, and the API calls
  them under `manageOrganization`.
  `auth.resolve_channel_credential(secret_sha256)` returns `channel_id`,
  `organization_id` and `kind` for one unrevoked row; EXECUTE goes to
  `bap_auth`, the role the web service already holds.
- The secret is `bap_intake_` followed by 32 random bytes in base64url. It is
  stored as sha256, an 8-character display prefix is kept for the settings page,
  and the plain value is returned exactly once by the issue response. A channel
  may hold two unrevoked credentials so a rotation can overlap; issuing a third
  is refused.
- Revocation is `revoked_at` on the credential, checked by the web lookup on
  every request; disabling is `enabled` on the channel, checked by the API on
  every request and by the worker at every dequeue. Nothing is cached.
- The JWT claims are unchanged: `{ iss, aud, sub, iat, exp }`, EdDSA, five
  minutes, `sub = channel_<uuid>`. The capability set of a channel is
  `{ inboxWrite }` and nothing else; every other route resolves no membership
  for a `channel_` subject and answers 403.
- The public path is organization-less: `POST /api/intake/v1/items` in the web
  service. The web hashes the bearer, calls `auth.resolve_channel_credential`,
  builds the upstream path
  `/v1/organizations/<organization_id>/inbox/channels/<channel_id>/items` from
  the credential row and mints the JWT. The API re-reads `app.inbox_channel`
  inside the tenant transaction bound to the path organization; a credential
  moved to the wrong organization finds no row and answers 404. The JWT carries
  no organization and the payload is never consulted for binding.
- Rate limits: `SubjectRateLimitGuard`
  (`apps/api/src/subject-rate-limit.guard.ts`) already keys on `sub`, so the
  per-channel limit exists without new code. The web adds an edge IP bucket for
  failed lookups, in the shape of the sign-up bucket in
  `docs/authentication.md`, so an unknown token cannot be guessed at line rate.

### Webhook

Inbound email arrives through Mailgun EU and is bound to a channel by the
recipient address alone.

- `POST /api/inbound/mailgun` in the web service. The signing key is read from
  `BAP_MAILGUN_WEBHOOK_SIGNING_KEY_FILE`, a mounted credential file as ADR 0005
  requires. The route verifies HMAC-SHA256 over `timestamp` concatenated with
  `token` using `timingSafeEqual`, and refuses a timestamp outside a 300 second
  window.
- Replay: the Mailgun `token` becomes `inbox_item.external_id`, so a re-delivery
  hits `inbox_item_external_id_key` and creates no second item; the exact-hash
  blob check runs second.
- Binding: the `recipient` local part `in-<token>@` is hashed and resolved as a
  credential of kind `email_address`. `From`, `To`, the body and any provider
  identity are never consulted. An unknown recipient answers 406 so Mailgun
  stops retrying.
- The web parses nothing beyond the form fields it needs; the raw MIME is
  streamed to
  `POST /v1/organizations/<organization_id>/inbox/channels/<channel_id>/email`.
  The API stores the `.eml` as a blob at `inbox_item_file.position = 1` (the
  schema requires `position >= 1`, so the plan's "file zero" is amended),
  `payload_kind = 'email'`, `origin` = sender address, and enqueues the
  understand job. The worker splits attachments into child items, at most 20 per
  message.
- The Caddy body cap is 25 MB for every path and Mailgun's ceiling is 25 MB; the
  inbound path is raised to 30 MB so a message at the ceiling plus form overhead
  is not bounced at the edge.

### Worker

- `runTenantJob` accepts the payload union above. A channel job opens its tenant
  transaction as `{ role: 'channel', userId: 'channel_<uuid>' }` after selecting
  the enabled channel row; there is no membership to resolve.
- Pull channels run from an organization-less cron tick.
  `app.list_due_channels()` is a `SECURITY DEFINER` function owned by
  `bap_owner` that returns channel ids and organization ids only, admitted by a
  policy `TO bap_owner USING (true)` on `app.inbox_channel`, because
  `FORCE ROW LEVEL SECURITY` applies to the owner too. The tick enqueues one job
  per channel with `singletonKey = channelId`.
- The orphan sweep inserts nothing. It walks `org/<organization_id>` directories
  in the blob volume and reads `app.blob` as the read-only subject
  `system_sweep`; no policy admits that subject to write, so a bug in the sweep
  cannot create rows.

### Answered questions

1. Auto-route under a channel. A rule acts on behalf of its author: the worker
   runs an auto-route as the rule's `created_by` user, re-resolved as a live
   write-role member at dequeue; when that member is gone the rule is paused.
   The channel role is never widened to route. Phase 1b.
2. Reply summaries. The email channel's reply to the sender is sent from the
   worker, so the mail transport moves out of the web application into
   `@bap/mail` with two real consumers, web and worker. Phase 1b.
3. MIME parsing. The worker parses MIME in-process for Phase 1 with caps: at
   most 20 attachments, per-part and total size limits, mailparser limits on
   header and nesting depth, and ClamAV before any attachment is parsed. An
   isolated parse process with no database role and no secrets is Phase 2 work,
   together with hardened XML parsing.

## Alternatives rejected

- A synthetic `auth.user` per channel: membership would grant the full role
  capability set, the row would appear in the members UI and count against
  limits, and Better Auth requires an email.
- A separate `bap.principal_kind` setting: it still needs a `bap.role` value for
  every policy, so it adds a setting without removing a branch.
- A dedicated database role for channels: ADR 0005 introduces no new database
  role, grants are table-level and would need a twin of every policy.
- Organization id in the JWT or the request path of the public route: the
  binding would depend on the caller; the credential row plus the RLS re-read is
  two independent checks.
- Parsing MIME in the web service: it would put a parser with the session cookie
  and the mail transport on the public edge.

## Consequences

- The Phase 1a migration edits the six named policies, adds
  `inbox_item_channel_update`, `app.role_is_channel()`,
  `app.list_due_channels()`, the `auth.user` CHECK and the `app.erase_user`
  guard, and bumps `DATABASE_MIGRATION_COMPATIBILITY`
  (`packages/db/src/access.ts`).
- SELECT policies on tenant tables carry no role predicate today. The Phase 1a
  migration adds `AND NOT app.role_is_channel()` to every non-inbox SELECT
  policy, so a channel context reads only the inbox tables and `app.blob`;
  foreign key checks bypass row level security, so composite pins still
  validate. The API refuses `channel_` subjects on every read route as well.
- `infrastructure/caddy/Caddyfile` gains a 30 MB `request_body` for
  `/api/inbound/*`. ClamAV joins the Compose stack and the internet egress
  allowlist for freshclam, so `scripts/verify-compose.mjs` and the member list
  in ADR 0004 change with it.
- Documents to update when the code lands: `docs/security.md` (a channel intake
  boundary section), `docs/authentication.md` (the resource-token boundary and
  the future identity list), `docs/database-isolation.md` (the `channel` role
  value, the credential table, the definer functions), `docs/configuration.md`
  (the new credential file and variables), `docs/documents.md` and
  `ARCHITECTURE.md` (the intake routes), `docs/planning/inbox.md` (amended by
  this record).
- Tests that must exist before any channel ships: a channel context cannot
  insert into `app.document`, `app.partner` or `app.dataset`; cannot update a
  routed item or set a destination column; cannot update an item whose
  `decided_by_kind` is `user`; cannot execute `app.erase_user`; a `channel_`
  subject is refused by every route except the two intake routes; and the worker
  throws for a disabled or missing channel at dequeue.
- ADR 0011 is amended: `bap.role` gains a value that is not a membership role,
  and one sibling resolver exists beside the shared one. ADR 0015's deferral of
  the principal is closed by this record.
