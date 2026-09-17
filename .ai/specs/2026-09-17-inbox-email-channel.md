# Inbox Email Channel (Phase 1a-email)

**Date:** 2026-09-17

## Problem

Phase 1a ([inbox channels](2026-09-17-inbox-channels.md)) gave a client's system
a token and an endpoint. A person forwarding an invoice from a mail client still
has nowhere to send it: `app.inbox_channel` accepts `kind = 'email'` and the
credential table accepts `kind = 'email_address'`, but nothing issues an
address, nothing receives mail and nothing opens an `.eml`.
[ADR 0016](../../docs/adr/0016-channel-principal.md) (Webhook and Worker
sections) decides the design; this spec delivers it, stacked on 1a.

## Scope

- Migration `20260917.0003_inbox_email.sql`: `app.record_blob_scan` with its
  `blob_maintenance_update` policy, the platform-unique
  `inbox_channel.email_address`, the recreated `auth.issue_channel_credential`,
  `inbox_item.sender`, the `inbox_item.origin` comment, compatibility bump.
- Web: `POST /api/inbound/mailgun/mime`, email channels on `/inbox/channels`.
- API: the channel email route, the quarantine gate on blob reads. Worker: the
  `split_email_item` job and the channel job payload union in `job-context.ts`.
- Compose: `clamd` with a pinned `clamd.conf`, `freshclam`, the `scan` network,
  `verify-compose.mjs` rules, the Caddy inbound cap, three new variables and an
  optional fourth.
- Out: `inbox_rule` and auto-route, AI extraction, ARES, pull channels and
  `poll_channels`, `sweep_orphan_blobs`, reply summaries and `@bap/mail`, an
  isolated parse process (Phase 2), a per-organization quota setting.

## Design

Mailgun facts, verified against the official documentation on 2026-09-17. A
forward URL ending in `mime` or `raw-mime` makes Mailgun include `body-mime`
with the raw MIME and omit `body-plain` and `body-html`; the post also carries
`recipient`, `sender`, `Message-Id`, `timestamp`, `token` (50 random characters)
and `signature`; 200 stops delivery, 406 means rejected and never retried, any
other code is retried for 8 hours
(https://documentation.mailgun.com/docs/mailgun/user-manual/receive-forward-store/receive-http).
The signature is the hex HMAC-SHA256 of `timestamp` concatenated with `token`,
no separator, keyed with the account's Webhook Signing Key
(https://documentation.mailgun.com/docs/mailgun/user-manual/webhooks/securing-webhooks).
The maximum message size Mailgun supports is 25 MB
(https://documentation.mailgun.com/docs/mailgun/user-manual/sending-messages/send-http).
The EU region has its own hosts: `api.eu.mailgun.net` for the REST API and
`mxa.eu.mailgun.org`, `mxb.eu.mailgun.org` for inbound routes
(https://documentation.mailgun.com/docs/mailgun/api-reference/api-overview). The
webhook itself is region-less: Mailgun EU posts to our host.

Migration. `app.record_blob_scan(blob_id uuid, status text)` is
`SECURITY DEFINER` owned by `bap_owner`, EXECUTE to `bap_api`; it updates
`scan_status` of the one blob whose
`organization_id = current_setting('bap.organization_id', true)`, nothing else,
raises on an unknown status and raises when zero rows update. `app.blob` is
FORCE RLS (`20260916.0001_inbox.sql:332`) and `blob_update` requires
`app.role_can_write()`, so the definer relies on a new policy
`blob_maintenance_update ON app.blob FOR UPDATE TO bap_owner USING (organization_id = current_setting('bap.organization_id', true))`,
the shape of `inbox_channel_maintenance_select`
(`20260917.0001_inbox_channels.sql:309`); `blob_update` stays closed to the
channel. `inbox_channel.email_address` gains
`unique (email_address) where email_address is not null`, a platform-wide
uniqueness because the intake domain is shared by every organization. The
migration runs `DROP FUNCTION auth.issue_channel_credential(uuid, text)`,
recreates it as
`auth.issue_channel_credential(channel_id uuid, kind text, intake_domain text default null)`
and re-grants EXECUTE to `bap_api`. The function refuses a kind that does not
match `inbox_channel.kind` (an `api` channel issues only `api_token`, an `email`
channel only `email_address`), and the active limit is per kind: two unrevoked
`api_token` rows, one unrevoked `email_address` row (the owner revokes and
reissues). For `email_address` the domain argument is required (the API passes
`BAP_INTAKE_DOMAIN`; the database stores no setting); the token is
`encode(gen_random_bytes(16), 'hex')`, 32 lowercase hex characters resolved
case-insensitively, the local part is `in-<32 hex>`, `secret_sha256` is the
sha256 of the lowercased local part, `display_prefix` is the first 8 characters
of the token after `in-`, and `<local>@<domain>` is written into
`inbox_channel.email_address`. `auth.revoke_channel_credential` clears
`inbox_channel.email_address` when the revoked row is of that kind.
`auth.resolve_channel_credential` is unchanged; the caller hashes the lowercased
local part. `app.inbox_item` gains `sender text` (nullable,
`length between 1 and 320`), and the `inbox_item.origin` column comment
(`20260917.0001_inbox_channels.sql:75`) is rewritten: origin is the credential
display prefix for every channel kind. `DATABASE_MIGRATION_COMPATIBILITY`
becomes `20260917.0003`.

Web. `POST /api/inbound/mailgun/mime` is public and organization-less; `api` is
already a reserved segment. An in-flight semaphore guards the route
(`BAP_INBOUND_MAX_IN_FLIGHT`, default 4); beyond it the route answers 503 so
Mailgun retries. Order: a declared `content-length` above 30 MB answers 406; the
form (`multipart/form-data` or `application/x-www-form-urlencoded`) is buffered
once, bounded by the Caddy cap, and the forwarded body reuses the same `Blob`
rather than a copy; `signature` must be exactly 64 hex characters, then
HMAC-SHA256 over `timestamp + token` with the key from
`BAP_MAILGUN_WEBHOOK_SIGNING_KEY_FILE` is compared with `timingSafeEqual`, and
`timestamp` must be within 300 seconds of now. A signature failure consumes the
edge IP bucket from `apps/web/src/lib/inbox/intake.ts` (that IP is not Mailgun)
and answers 406, or 429 when the bucket is already full. A signed post never
consumes the bucket: `recipient` is parsed, the local part lowercased, the `in-`
prefix required, the local part hashed and resolved through
`auth.resolve_channel_credential` on the `bap_auth` pool, and a miss or a row of
kind other than `email_address` answers 406 without touching the bucket, since
128 bits of token entropy make enumeration moot and Mailgun stops retrying. The
route then mints the channel JWT (`sub = channel_<uuid>`, the 1a mint) and
forwards `body-mime` as a `message/rfc822` body to the API email route with
`x-bap-intake-origin` = the credential `display_prefix` and
`x-bap-intake-external-id` = the Mailgun `token`; a post without `token` fails
the signature anyway, so there is no `Message-Id` fallback. Mailgun may re-sign
a retry with a fresh token (to verify in staging); if so, the exact-hash rule
dedupes retries and the replay index catches only true duplicates.
`x-bap-intake-sender` is sent only when `sender` is printable ASCII, otherwise
omitted, because a non-ASCII `fetch` header throws. Upstream 202 answers 200;
400, 404, 413 and 415 answer 406; everything else answers 502 so Mailgun
retries. Logs carry operation, reason and ids only.

API. `POST /v1/organizations/:organizationId/inbox/channels/:channelId/email`
accepts a `ChannelAccess` only (a `TenantAccess` answers 403, so a browser
session never submits an `.eml` here), requires `content-type: message/rfc822`,
streams the body under its own `MAX_EMAIL_BYTES = 30 MB` cap (separate from
`MAX_UPLOAD_BYTES`, 413 past it), validates the three intake headers at the
boundary (origin as in 1a, external id 1..128 of `[A-Za-z0-9_-]`, sender 1..320
when present), and calls `receiveIntake` with `channelKind = 'email'`,
`payloadKind = 'email'`, `origin` and `externalId`. The email branch of
`receiveIntake` stores the `.eml` as blob position 1 with
`media_type = 'message/rfc822'`, runs no sniff, leaves the item `received` with
a `received` event, and writes `sender` as null: the worker fills it from the
parsed MIME. The channel row is checked, the per-channel replay index answers an
earlier item, and the Phase 0 exact-hash rule lands a duplicate `.eml` as
`discarded` with reason `duplicate`. After commit, a `received` item enqueues
`split_email_item` with `{ organizationId, channelId, itemId }`, ids only per
ADR 0005, `retryLimit: 3`, `retryDelay: 60`, `singletonKey = itemId`. Answers
202 with the item id and never returns content. `readBlob` gates on
`scan_status`, so the blob download and inline routes refuse an `infected` or
`failed` blob with 409 `blob_quarantined`.

Worker. `tenantJobPayloadSchema` is strict with `userId` required
(`job-context.ts:16-21`); `runTenantJob` parses a union of it and
`{ organizationId, channelId, itemId }` where both ids are `z.string().uuid()`,
not `subjectIdentifierSchema`. A channel job selects the enabled, undeleted
channel row, throws when it is missing or disabled, and opens the transaction as
`{ role: 'channel', userId: 'channel_<uuid>' }`, no membership.
`split_email_item` sets the parent to `processing` (existing event kinds only:
`scanned` per blob, `classified` per sniffed child, `discarded` and `failed`
where they apply, no new kind) and scans the `.eml` blob through `clamd`
INSTREAM over TCP to `BAP_CLAMAV_HOST:3310`, the production path for every blob.
Outcomes: `FOUND` records `infected` through `app.record_blob_scan` and discards
the item (child or parent) with reason `policy_rejected`, nothing else runs on
it; `ERROR`, an unreachable `clamd`, or a `clamd` with no database yet throws,
so pg-boss retries; only when `job.retryCount >= retryLimit` the handler records
`scan_status = 'failed'` and marks the parent `failed` (the `ingest-dataset.ts`
failure recording pattern), never `discarded`. The split is idempotent: each
child carries `external_id = '<parentItemId>:<n>'` under the per-channel replay
index, so a retry skips children that already exist. It then parses the `.eml`
with mailparser `simpleParser` on a stream (`skipHtmlToText: true`,
`skipImageLinks: true`, `skipTextToHtml: true`, `maxHtmlLengthToParse` at 1 MB)
and enforces in code what mailparser cannot: at most 20 attachments, 25 MB per
attachment, 1 MB of text, a nesting depth of 10; past a cap the parent becomes
`needs_review` with a `failed` event reason `too_large` and the already created
children stay. Each attachment becomes a child `inbox_item` (`parent_item_id`,
same `channel_id`, `channel_kind = 'email'`, `payload_kind = 'file'`, `origin`
inherited, `sender` from the parsed envelope, `legal_entity_id` and `hint_kind`
from the channel) whose blob is content-addressed at position 1 under the
organization dedup rule (an existing hash makes the child `discarded` as
`duplicate` and skips the scan). A message with no attachment gets one child of
`payload_kind = 'text'` holding the plain text body as its blob; a message with
neither attachments nor text produces no child and never a zero-byte blob
(`blob_byte_size_check`): the parent becomes `needs_review` with issue `empty`.
Every new blob is scanned before the sniff; `clean` runs the Phase 0 sniff
synchronously, leaving the child `needs_review`. Done, the parent becomes
`needs_review`. Split errors are wrapped to a code before they reach `runJob`,
so `worker.ts` never logs addresses or row values.

Compose and Caddy. `clamd` is the official `clamav/clamav` image pinned by
digest with `CLAMAV_NO_FRESHCLAMD=true`, on a new internal network `scan` shared
only with `worker`, `read_only`, `cap_drop: ALL`, `user:` set, tmpfs
`/run/clamav` with the matching `uid` and tmpfs `/tmp`, the signature volume
mounted read-only. Its configuration is a read-only `clamd.conf` mount:
`StreamMaxLength 30M`, `MaxFileSize 25M`, `MaxScanSize 60M`, `MaxRecursion 10`,
`MaxFiles 200`, `MaxScanTime 60000`, `AlertExceedsMax yes`,
`DatabaseMirror database.clamav.net`; its `SelfCheck` reload picks up new
signatures. `freshclam` is the same image with `CLAMAV_NO_CLAMD=true`,
`NotifyClamd` disabled and its healthcheck overridden, on `internet-egress`
only, writing the shared signature volume; ADR 0004's member list becomes `web`,
`worker`, `freshclam`. On first boot `clamd` has no database until `freshclam`
completes, which the split job treats as a `clamd` error (retry);
`docs/deployment.md` says to run `freshclam` once before enabling email
channels. `verify-compose.mjs` gains: `scan` is internal with members exactly
`clamd` and `worker`; `clamd` has no `data` and no `internet-egress`;
`freshclam` has `internet-egress` only; both are digest pinned, `read_only`,
`cap_drop: ALL`, with tmpfs `/run/clamav`; the worker network list becomes
`data,internet-egress,scan`. The Caddyfile general `request_body` block gains
`not path /api/inbound/*` and a `@inbound path /api/inbound/*` block sets
`max_size 30MB`. New variables: `BAP_MAILGUN_WEBHOOK_SIGNING_KEY_FILE` (web,
mounted file), `BAP_INTAKE_DOMAIN` (api), `BAP_CLAMAV_HOST` (worker), plus the
optional `BAP_INBOUND_MAX_IN_FLIGHT` (web), documented in
`docs/configuration.md`. `docs/deployment.md` gains the Mailgun setup: MX
records of the intake domain to `mxa.eu.mailgun.org` and `mxb.eu.mailgun.org`,
one route `match_recipient(".*@<domain>")` with action
`forward("https://<host>/api/inbound/mailgun/mime")`. `docs/security.md` extends
the channel principal section with the email boundary.

Settings page. `/inbox/channels` lists email channels beside API channels;
creating an email channel issues its address at once through the credential
route; the address is shown on the row with a copy button and can be revoked and
reissued, never a second active one. The address is not a secret shown once: it
is stored plain on the channel row by ADR 0016.

Amendments to ADR 0016, each recorded in the ADR with the code. The Principal
section says both intake routes accept a `ChannelAccess` or a `TenantAccess`;
the email route accepts a `ChannelAccess` only. The Webhook section says
`origin` = sender address; 1a already defined `origin` as the credential display
prefix, so this spec keeps that, stores the envelope sender in the new
`inbox_item.sender` column and rewrites the `inbox_item.origin` comment.

## Security

Untrusted input crosses two boundaries. At the web edge Mailgun's form is
untrusted until the signature verifies; the signing key proves the poster is
Mailgun, never the tenant, and the recipient token is the only binding. The
sender, `From`, `To`, subject and body bind nothing and are never consulted for
routing. The token appears in the address the owner hands out, so a leaked
address is revoked and reissued; it is stored hashed. In the worker hostile MIME
is parsed in-process as `bap_api` under the channel role: caps in code, ClamAV
before any attachment is parsed, no new database role; the isolated parse
process is Phase 2. The channel role still cannot read tenant data or route.
Never logged, audited or sent anywhere: sender, recipient, token, subject,
headers, body, attachment names. Logs and `inbox_event` carry ids, reasons and
counts. The webhook signing key is read once from its file and never echoed.

## Verification

- `apps/web` unit: signature vectors (valid, 63 and 65 characters, non-hex,
  expired, wrong key); the bucket is consumed on a signature failure only and a
  signed unknown recipient answers 406 without consuming it; the fifth in-flight
  post answers 503; a 25 MB `body-mime` field survives the form parser
  untruncated; an `api_token` credential on the email route is a miss; missing
  `in-` prefix 406; declared `content-length` over the cap 406; upstream mapping
  202 to 200, 404 to 406, 500 to 502; settings page for an email channel.
- `apps/api` unit and integration: email route under `TenantAccess` is 403;
  wrong content type 415; 30 MB cap 413; the stored item is `received` with
  `media_type = 'message/rfc822'` and no sniff; replay by external id creates no
  second item; duplicate `.eml` lands `discarded`; the enqueued payload has ids
  only with the retry options; download and inline of an `infected` or `failed`
  blob answer 409 `blob_quarantined`.
- Worker: `runTenantJob` throws for a missing or disabled channel and refuses a
  non-uuid `itemId`; split tests with synthetic MIME fixtures: two attachments,
  none (text child), neither (`needs_review`, issue `empty`, no blob), 21
  attachments, an oversize attachment, nesting past 10; EICAR in the parent
  `.eml` against a fake `clamd` (parent `discarded`, `policy_rejected`,
  `scan_status = 'infected'`) and in a child; `clamd` `ERROR` and unreachable
  throw and retry while `scan_status` stays untouched; retry exhaustion writes
  `failed` on the blob and the parent; a retry after a partial split creates no
  second child.
- `packages/db` integration: `record_blob_scan` updates only `scan_status` of
  the caller's organization, raises on an unknown status and on zero rows, and
  `blob_update` still denies the channel while `blob_maintenance_update` admits
  only `bap_owner` within the caller's organization; an `email_address`
  credential resolves by lowercased local part; a third `api_token` and a second
  `email_address` are refused; `api_token` on an email channel and
  `email_address` on an api channel are refused; revoke clears the address; the
  platform-unique address.
- `pnpm compose:verify`, `pnpm check` locally, `pnpm test:integration` in CI.

## Open questions

- An item stuck in `received` when the enqueue after commit fails. Proposal: a
  `poll`-less requeue on the next intake of the same channel, or leave it to the
  1b sweep. Open.
- The reply to the sender listing created items and skipped files stays in Phase
  1b with `@bap/mail`.
