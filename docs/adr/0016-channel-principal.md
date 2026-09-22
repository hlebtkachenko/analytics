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

## Delivery

This record holds the whole decision. It ships in three pull requests, each with
its own spec; every section below names the one that delivers it.

- Phase 1a: the principal, the intake API credential, the public intake route
  and the channel settings page for API channels. Spec:
  [inbox channels](../../.ai/specs/2026-09-17-inbox-channels.md).
- Phase 1a-email, stacked on 1a: the Mailgun webhook, the API email route, the
  `split_email_item` job, ClamAV, email channels in the settings page and the
  Caddy cap. Its spec is written when 1a lands.
- Phase 1b: the `poll_channels` skeleton, `app.list_due_channels()` and
  `sweep_orphan_blobs`. Amended 2026-09-17 (1b-runtime): `sweep_orphan_blobs` is
  superseded by the `inbox_maintenance` worker tick's orphan sweep task; its
  spec is [inbox runtime](../../.ai/specs/2026-09-17-inbox-runtime.md).

## Decision

### Principal (Phase 1a)

A channel is a principal of its own, expressed with the settings that already
exist and nothing new in the database role set.

- `bap.role = 'channel'` and `bap.user_id = 'channel_<uuid>'`, where the uuid is
  `app.inbox_channel.id`. No `auth.user` row, no new setting, no new database
  role.
- `app.role_is_channel()` is a new STABLE, SECURITY INVOKER function beside
  `app.role_can_write()` and `app.role_is_owner()`. EXECUTE goes to `bap_api`
  and `bap_reporting`, because SELECT policies reference it and the reporting
  role evaluates them; `app.role_can_write()` stays `bap_api` only
  (`20260910.0001_legal_entities.sql:97`). `app.role_can_write()` is not
  changed, so a channel is denied on every table by construction; a policy
  admits a channel only by naming `app.role_is_channel()`.
- Exactly five INSERT policies opt in: `blob_insert`, `inbox_item_insert`,
  `inbox_item_file_insert`, `inbox_item_extraction_insert` and
  `inbox_event_insert`. Each is spelled with explicit parentheses,
  `... AND (app.role_can_write() OR app.role_is_channel())`, and the
  `created_by = current_setting('bap.user_id', true)` check stays outside the
  parentheses so a channel still writes only as itself. `blob_update` does not
  opt in. `document_file_insert` and every `document`, `partner`, `dataset` and
  `legal_entity` policy stay as they are.
- One new policy, `inbox_item_channel_update`. USING:
  `organization_id = current_setting('bap.organization_id', true) AND app.role_is_channel() AND status <> 'routed' AND decided_by_kind IS DISTINCT FROM 'user'`.
  WITH CHECK: the same predicate plus
  `AND document_id IS NULL AND dataset_id IS NULL AND partner_id IS NULL`. A
  channel can move its item through `received`, `processing`, `needs_review` and
  `failed`; it can never route, un-route or overwrite a person's decision. A
  channel-created item starts as `received`, or `discarded` when its bytes are
  an exact-hash duplicate, exactly as a Phase 0 upload does.
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
  means 404. It returns a `ChannelAccess` value
  `{ organizationId, channelId, subject }`, a type distinct from `TenantAccess`.
  There is no channel capability: `organizationCapabilitiesSchema` is strict
  (`packages/security/src/access-contract.ts:56-67`) and gains no key. The two
  intake routes accept a `ChannelAccess` or a `TenantAccess` with
  `manageDocuments`; every other route requires a `TenantAccess` and answers 403
  to a `channel_` subject. Amended 2026-09-17: the email route accepts a
  `ChannelAccess` only and answers 403 to a `TenantAccess`.
- Non-inbox SELECT policies carry no role predicate today. They gain
  `AND NOT app.role_is_channel()`, so a channel context reads only the inbox
  tables and `app.blob`; foreign key checks bypass row level security, so
  composite pins still validate. `audit_log_isolation` is an ALL policy
  (`20260830.0003_data_grants_and_audit.sql`); it is split into a SELECT policy
  that excludes the channel and a write policy that does not, so a channel
  cannot read `app.audit_log` while inserts through `app.record_audit` keep
  working.

### Token (Phase 1a)

An API channel authenticates with a credential that lives in `auth`, never in a
tenant table.

- `auth.inbox_channel_credential`: `id`, `channel_id`, `organization_id`, `kind`
  (`api_token` or `email_address`), `secret_sha256`, `display_prefix`,
  `created_by`, `created_at`, `revoked_at`. Tables created in `auth` inherit DML
  for `bap_auth`, so the REVOKE of that default grant follows the CREATE in the
  same migration, as `docs/security.md` records for `auth.platform_setting`;
  `bap_api` holds no direct grant either. Three `SECURITY DEFINER` functions
  owned by `bap_owner` with a fixed search path are the only surface, following
  `auth.resolve_membership`.
- `auth.issue_channel_credential(channel_id, kind)` and
  `auth.revoke_channel_credential(credential_id)` take the organization and the
  acting subject from the transaction settings, never as arguments, so they run
  only inside a tenant transaction. `issue_channel_credential` filters the
  channel by `organization_id = current_setting('bap.organization_id', true)`
  explicitly and asserts `current_setting('bap.role', true) = 'owner'` before it
  inserts. EXECUTE goes to `bap_api`, and the API calls both under
  `manageOrganization`. `auth.resolve_channel_credential(secret_sha256)` returns
  `channel_id`, `organization_id` and `kind` for one unrevoked row; EXECUTE goes
  to `bap_auth`, the role the web service already holds.
- The secret is `bap_intake_` followed by 32 random bytes in base64url. It is
  stored as sha256 only, an 8-character display prefix is kept for the settings
  page, and the plain value is returned exactly once by the issue response. A
  channel may hold two unrevoked credentials so a rotation can overlap; issuing
  a third is refused. The one exception to hash-only storage is
  `inbox_channel.email_address` (Phase 1a-email): the owner must read the
  address to give it out, so it is stored plain on the channel row while the
  credential row keeps its hash. Email address tokens use a lowercase base32
  alphabet and are resolved case-insensitively, because an MTA may lowercase a
  local part. Amended 2026-09-17: the token is 32 lowercase hex characters from
  `encode(gen_random_bytes(16), 'hex')`, and the local part is `in-<32 hex>`,
  not base32.
- Revocation is `revoked_at` on the credential, checked by the web lookup on
  every request; disabling is `enabled` on the channel, checked by the API on
  every request and, once channel jobs exist, by the worker at every dequeue.
  Nothing is cached.
- The JWT claims are unchanged: `{ iss, aud, sub, iat, exp }`, EdDSA, five
  minutes, `sub = channel_<uuid>`.
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
  per-channel limit exists without new code. The web adds an edge IP bucket in
  the shape of the sign-up bucket (`docs/security.md`, public sign-up boundary):
  it is checked before the credential lookup and consumed on a miss, so an
  unknown token cannot be guessed at line rate.

### Webhook (Phase 1a-email)

Inbound email arrives through Mailgun EU and is bound to a channel by the
recipient address alone.

- `POST /api/inbound/mailgun/mime` in the web service. The Mailgun forward URL
  must end with `mime`, otherwise Mailgun posts parsed fields instead of
  `body-mime`. The signing key is read from
  `BAP_MAILGUN_WEBHOOK_SIGNING_KEY_FILE`, a mounted credential file as ADR 0005
  requires. The route first checks that the posted signature is exactly 64 hex
  characters, then verifies HMAC-SHA256 over `timestamp` concatenated with
  `token` using `timingSafeEqual`, and refuses a timestamp outside a 300 second
  window.
- The edge IP bucket from the token section is checked before the recipient
  lookup and consumed on a miss, the same shape as the sign-up bucket. Amended
  2026-09-17: the bucket is consumed only on signature failure; a signed miss
  answers 406 without consuming it; an in-flight semaphore answers 503 beyond
  `BAP_INBOUND_MAX_IN_FLIGHT`. Amended 2026-09-17: a signature failure,
  including a body that is not a form, answers 401; every permanent refusal of a
  signed request answers 406.
- Replay: the Mailgun `token` becomes `inbox_item.external_id`, with the sha256
  of the `Message-Id` header as the fallback when the token is absent, so a
  re-delivery hits `inbox_item_external_id_key` and creates no second item; the
  exact-hash blob check runs second. Amended 2026-09-17: `external_id` is the
  Mailgun `token` only; there is no `Message-Id` fallback.
- Binding: the `recipient` local part `in-<token>@` is hashed and resolved as a
  credential of kind `email_address`. `From`, `To`, the body and any provider
  identity are never consulted. An unknown recipient answers 406 so Mailgun
  stops retrying.
- The web parses nothing beyond the form fields it needs; the raw MIME is
  streamed to
  `POST /v1/organizations/<organization_id>/inbox/channels/<channel_id>/email`.
  The API stores the `.eml` as a blob at `inbox_item_file.position = 1` (the
  schema requires `position >= 1`, so the plan's "file zero" is amended),
  `payload_kind = 'email'`, `origin` = sender address, and enqueues
  `split_email_item`. The worker splits attachments into child items, at most 20
  per message. Amended 2026-09-17: `origin` stays the credential display prefix
  as Phase 1a defined it, the sender lives in `inbox_item.sender`, and the Phase
  1a-email migration rewrites the `inbox_item.origin` column comment
  (`packages/db/drizzle/20260917.0001_inbox_channels.sql:75`).
- Body caps. The general `request_body` block in
  `infrastructure/caddy/Caddyfile` stays at 25 MB and gains
  `not path /api/inbound/*`; the inbound path gets its own 30 MB block, because
  Mailgun's ceiling is 25 MB and a message at the ceiling plus form overhead
  must not bounce at the edge. The API email route enforces its own 30 MB byte
  cap on the stream so the limit does not depend on Caddy alone.
- ClamAV: `clamd` runs on a dedicated internal network shared only with the
  worker; `freshclam` is a separate service on `internet-egress`; both images
  are digest pinned and `/run/clamav` is a tmpfs. `scripts/verify-compose.mjs`
  gains those rules. mailparser has no options for attachment count, total
  bytes, per-attachment bytes or concurrency, so the worker enforces those caps
  in its own code around the stream.

### Worker (Phase 1a-email and 1b)

- `runTenantJob` accepts a payload union, `{ organizationId, userId }` or
  `{ organizationId, channelId }`. A channel job opens its tenant transaction as
  `{ role: 'channel', userId: 'channel_<uuid>' }` after selecting the enabled
  channel row and throws when it is missing or disabled, exactly as a revoked
  membership fails a user job today; there is no membership to resolve. The
  union lands with `split_email_item` in Phase 1a-email; Phase 1a has no channel
  job, because `understand_inbox_item` stays synchronous as in Phase 0.
- Pull channels run from an organization-less cron tick (Phase 1b).
  `app.list_due_channels()` is a `SECURITY DEFINER` function owned by
  `bap_owner` that returns channel ids and organization ids only, admitted by a
  policy `TO bap_owner USING (true)` on `app.inbox_channel`, because
  `FORCE ROW LEVEL SECURITY` applies to the owner too. The tick enqueues one job
  per channel with `singletonKey = channelId`.
- The orphan sweep (Phase 1b) inserts nothing. It walks `org/<organization_id>`
  directories in the blob volume and reads `app.blob` as the read-only subject
  `system_sweep`; no policy admits that subject to write, so a bug in the sweep
  cannot create rows. Amended 2026-09-17 (1b-runtime): the orphan sweep ships as
  a worker tick with no database subject at all; it walks
  `org/<organization_id>` under the blob volume, asks
  `app.list_blob_keys(organization_id, sha256s)`, a `SECURITY DEFINER` function
  that raises inside any tenant transaction, which hashes have a `blob` row, and
  unlinks only files older than 60 minutes with no row; it deletes no row.
  Amended 2026-09-17 (1b-rules): `system_sweep` is replaced by
  `system_automation`, the read-only subject the `route_inbox_item` job opens
  its first transaction as (`{ role: 'member', userId: 'system_automation' }`)
  to read the item and the rule author before re-resolving that author; no
  policy admits it to write, its only write is
  `app.record_inbox_automation_skip`, and `user_id_not_system_check`
  (`id NOT LIKE 'system\_%'`) on `auth."user"` plus the matching
  `app.erase_user` refusal keep the subject from ever colliding with a real
  account.
- `blob.scan_status` is written through a security definer
  `app.record_blob_scan(blob_id uuid, status text)` with EXECUTE to `bap_api`,
  which updates that column and nothing else; `blob_update` never opts in for
  the channel. Nothing in Phase 1a calls it, so it is defined in the Phase
  1a-email migration, not in 1a.

### Answered questions

1. Auto-route under a channel. A rule acts on behalf of its author: the worker
   runs an auto-route as the rule's `created_by` user, re-resolved as a live
   write-role member at dequeue; when that member is gone the rule is paused.
   The channel role is never widened to route. Phase 1b.
2. Reply summaries. The email channel's reply to the sender is sent from the
   worker, so the mail transport moves out of the web application into
   `@bap/mail` with two real consumers, web and worker. Phase 1b.
3. MIME parsing. The worker parses MIME in-process for Phase 1a-email with the
   caps above and ClamAV before any attachment is parsed. An isolated parse
   process with no database role and no secrets is Phase 2 work, together with
   hardened XML parsing.

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

- The Phase 1a migration edits the five named INSERT policies and the non-inbox
  SELECT policies with `ALTER POLICY` rather than drop and create, splits
  `audit_log_isolation`, adds `inbox_item_channel_update`,
  `app.role_is_channel()`, the `auth.user` CHECK and the `app.erase_user` guard,
  and bumps `DATABASE_MIGRATION_COMPATIBILITY` (`packages/db/src/access.ts`).
  The runner applies it in one transaction (`packages/db/src/migrations.ts`),
  rollback is forward-only by restore, and the CHECK validates every existing
  `auth.user` row when it is added.
- The API refuses `channel_` subjects on every route except the two intake
  routes.
- Phase 1a-email changes `infrastructure/caddy/Caddyfile`, adds ClamAV to the
  Compose stack and to the internet egress allowlist for `freshclam`, so
  `scripts/verify-compose.mjs` and the member list in ADR 0004 change with it.
- Documents to update when the code lands: `docs/security.md` (a channel intake
  boundary section), `docs/authentication.md` (the resource-token boundary and
  the future identity list), `docs/database-isolation.md` (the `channel` role
  value, the credential table, the definer functions), `docs/configuration.md`
  (the new credential file and variables), `docs/documents.md` and
  `ARCHITECTURE.md` (the intake routes), `docs/planning/inbox.md` (amended by
  this record).
- Tests that must exist before any channel ships: a channel context cannot read
  or insert into `app.document`, `app.partner` or `app.dataset` and cannot read
  `app.audit_log`; `bap_reporting` reads still work after the SELECT policy
  change; a channel cannot update a routed item, set a destination column or
  update an item whose `decided_by_kind` is `user`; cannot execute
  `app.erase_user`; `bap_auth` holds no direct DML on the credential table; a
  `channel_` subject is refused by every route except the two intake routes;
  and, once channel jobs exist, the worker throws for a disabled or missing
  channel at dequeue.
- ADR 0011 is amended: `bap.role` gains a value that is not a membership role,
  and one sibling resolver exists beside the shared one. ADR 0015's deferral of
  the principal is closed by this record.
