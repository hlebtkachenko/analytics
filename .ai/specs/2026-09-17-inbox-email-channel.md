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

- Migration `20260917.0003_inbox_email.sql`: `app.record_blob_scan`, the
  platform-unique `inbox_channel.email_address`, the `email_address` kind in
  `auth.issue_channel_credential`, `inbox_item.sender`, compatibility bump.
- Web: `POST /api/inbound/mailgun/mime`, email channels on `/inbox/channels`.
- API: the channel email route. Worker: the `split_email_item` job and the
  channel job payload union in `job-context.ts`.
- Compose: `clamd` and `freshclam`, the `scan` network, `verify-compose.mjs`
  rules, the Caddy inbound cap, three new variables.
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
and raises on an unknown status; `blob_update` stays closed to the channel.
`inbox_channel.email_address` gains
`unique (email_address) where email_address is not null`, a platform-wide
uniqueness because the intake domain is shared by every organization.
`auth.issue_channel_credential(channel_id uuid, kind text, intake_domain text default null)`:
for `email_address` the domain argument is required (the API passes
`BAP_INTAKE_DOMAIN`; the database stores no setting), the function generates
`in-<26 lowercase base32 characters>` from 16 random bytes, stores the sha256 of
the lowercased local part as `secret_sha256`, keeps the first 8 characters as
`display_prefix`, writes `<local>@<domain>` into `inbox_channel.email_address`,
and refuses when the channel already holds an unrevoked `email_address`
credential (at most one active address; the owner revokes and reissues).
`auth.revoke_channel_credential` clears `inbox_channel.email_address` when the
revoked row is of that kind. `auth.resolve_channel_credential` is unchanged; the
caller hashes the lowercased local part. `app.inbox_item` gains `sender text`
(nullable, `length between 1 and 320`), the SMTP envelope sender as reported by
Mailgun. `DATABASE_MIGRATION_COMPATIBILITY` becomes `20260917.0003`.

Web. `POST /api/inbound/mailgun/mime` is public and organization-less; `api` is
already a reserved segment. Order: the edge IP bucket from
`apps/web/src/lib/inbox/intake.ts` is checked first (429 on full); a declared
`content-length` above 30 MB is refused; the form (`multipart/form-data` or
`application/x-www-form-urlencoded`) is parsed once, bounded by the Caddy cap;
`signature` must be exactly 64 hex characters, then HMAC-SHA256 over
`timestamp + token` with the key from `BAP_MAILGUN_WEBHOOK_SIGNING_KEY_FILE` is
compared with `timingSafeEqual`, and `timestamp` must be within 300 seconds of
now, otherwise 406; `recipient` is parsed, the local part lowercased, the `in-`
prefix required, the local part hashed and resolved through
`auth.resolve_channel_credential` on the `bap_auth` pool, and a miss or a row of
kind other than `email_address` consumes the bucket and answers 406 (Mailgun
stops retrying). The route then mints the channel JWT (`sub = channel_<uuid>`,
the 1a mint) and forwards `body-mime` as a `message/rfc822` body to the API
email route with `x-bap-intake-origin` = the credential `display_prefix`,
`x-bap-intake-external-id` = the Mailgun `token` or, when absent, the sha256 of
`Message-Id`, and `x-bap-intake-sender` = `sender`. Upstream 202 answers 200;
400, 404, 413 and 415 answer 406; everything else answers 502 so Mailgun
retries. Logs carry operation, reason and ids only.

API. `POST /v1/organizations/:organizationId/inbox/channels/:channelId/email`
accepts a `ChannelAccess` only (a `TenantAccess` answers 403, so a browser
session never submits an `.eml` here), requires `content-type: message/rfc822`,
streams the body under its own `MAX_EMAIL_BYTES = 30 MB` cap (separate from
`MAX_UPLOAD_BYTES`, 413 past it), validates the three intake headers at the
boundary (origin as in 1a, external id 1..128 of `[A-Za-z0-9_-]`, sender
1..320), and calls `receiveIntake` with `channelKind = 'email'`,
`payloadKind = 'email'`, `origin`, `externalId` and `sender`. The channel row is
checked, the per-channel replay index answers an earlier item, and the `.eml` is
stored as blob position 1 through the Phase 0 exact-hash rule (`received`, or
`discarded` as `duplicate`). After commit, a `received` item enqueues
`split_email_item` with `{ organizationId, channelId, itemId }`, ids only per
ADR 0005. Answers 202 with the item id and never returns content.

Worker. `runTenantJob` parses a payload union, `{ organizationId, userId }` or
`{ organizationId, channelId }`; a channel job selects the enabled, undeleted
channel row, throws when it is missing or disabled, and opens the transaction as
`{ role: 'channel', userId: 'channel_<uuid>' }`, no membership.
`split_email_item` sets the parent to `processing` (existing event kinds only:
`scanned` per blob, `classified` per sniffed child, `discarded` and `failed`
where they apply, no new kind), scans the `.eml` blob through `clamd` INSTREAM
over TCP to `BAP_CLAMAV_HOST:3310` and records the result with
`app.record_blob_scan`; an `infected` or `failed` parent scan discards the
parent with reason `policy_rejected` and ends the job. It then parses the `.eml`
with mailparser `simpleParser` on a stream, enforcing in code what mailparser
cannot: at most 20 attachments, 25 MB per attachment, 60 MB decoded in total, 1
MB of text; past a cap the parent becomes `needs_review` with a `failed` event
reason `too_large` and the already created children stay. Each attachment
becomes a child `inbox_item` (`parent_item_id`, same `channel_id`,
`channel_kind = 'email'`, `payload_kind = 'file'`, `origin` and `sender`
inherited, `external_id` null, `legal_entity_id` and `hint_kind` from the
channel) whose blob is content-addressed at position 1 under the organization
dedup rule (an existing hash makes the child `discarded` as `duplicate` and
skips the scan). A message with no attachment gets one child of
`payload_kind = 'text'` holding the plain text body as its blob. Every new blob
is scanned before the sniff; `infected` or `failed` discards the child with
`policy_rejected` and nothing else runs on it; `clean` runs the Phase 0 sniff
synchronously, leaving the child `needs_review`. An unreachable `clamd` throws,
so pg-boss retries; after the last retry the parent is `failed`. Done, the
parent becomes `needs_review`.

Compose and Caddy. `clamd` is the official `clamav/clamav` image pinned by
digest with `CLAMAV_NO_FRESHCLAMD=true`, on a new internal network `scan` shared
only with `worker`, `read_only`, `cap_drop: ALL`, tmpfs `/run/clamav` and
`/tmp`, the signature volume mounted read-only; its `SelfCheck` reload picks up
new signatures. `freshclam` is the same image with `CLAMAV_NO_CLAMD=true`, on
`internet-egress` only, writing the shared signature volume; ADR 0004's member
list becomes `web`, `worker`, `freshclam`. `verify-compose.mjs` gains: `scan` is
internal with members exactly `clamd` and `worker`; `clamd` has no `data` and no
`internet-egress`; `freshclam` has `internet-egress` only; both are digest
pinned, `read_only`, `cap_drop: ALL`, with tmpfs `/run/clamav`; the worker
network list becomes `data,internet-egress,scan`. The Caddyfile general
`request_body` block gains `not path /api/inbound/*` and a
`@inbound path /api/inbound/*` block sets `max_size 30MB`. New variables:
`BAP_MAILGUN_WEBHOOK_SIGNING_KEY_FILE` (web, mounted file), `BAP_INTAKE_DOMAIN`
(api), `BAP_CLAMAV_HOST` (worker), documented in `docs/configuration.md`.
`docs/deployment.md` gains the Mailgun setup: MX records of the intake domain to
`mxa.eu.mailgun.org` and `mxb.eu.mailgun.org`, one route
`match_recipient(".*@<domain>")` with action
`forward("https://<host>/api/inbound/mailgun/mime")`. `docs/security.md` extends
the channel principal section with the email boundary.

Settings page. `/inbox/channels` lists email channels beside API channels;
creating an email channel issues its address at once through the credential
route; the address is shown on the row with a copy button and can be revoked and
reissued, never a second active one. The address is not a secret shown once: it
is stored plain on the channel row by ADR 0016.

Amendment to ADR 0016. The Webhook section says `origin` = sender address. 1a
already defined `origin` as the credential display prefix, so this spec keeps
that and stores the envelope sender in the new `inbox_item.sender` column; the
ADR line is corrected with the code.

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
  expired, wrong key); bucket checked before signature and consumed on an
  unknown recipient only; unknown recipient 406; an `api_token` credential on
  the email route is a miss; missing `in-` prefix 406; upstream mapping 202 to
  200, 404 to 406, 500 to 502; settings page for an email channel.
- `apps/api` unit and integration: email route under `TenantAccess` is 403;
  wrong content type 415; 30 MB cap 413; replay by external id creates no second
  item; duplicate `.eml` lands `discarded`; the enqueued payload has ids only.
- Worker: `runTenantJob` throws for a missing or disabled channel; split tests
  with synthetic MIME fixtures: two attachments, none (text child), 21
  attachments, an oversize attachment, EICAR against a fake `clamd` (child
  `discarded`, `policy_rejected`, `scan_status = 'infected'`), an unreachable
  `clamd` throws.
- `packages/db` integration: `record_blob_scan` updates only `scan_status` of
  the caller's organization, refuses an unknown status, and `blob_update` still
  denies the channel; an `email_address` credential resolves by lowercased local
  part; a second active address is refused; revoke clears the address; the
  platform-unique address.
- `pnpm compose:verify`, `pnpm check` locally, `pnpm test:integration` in CI.

## Open questions

None. The reply to the sender listing created items and skipped files stays in
Phase 1b with `@bap/mail`.
