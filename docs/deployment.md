# Deployment

## Validate models

```sh
pnpm secrets:local
pnpm compose:config
pnpm compose:config:production
pnpm compose:verify
```

## Local Compose stack

```sh
cp config/compose.environment.example .env
pnpm secrets:local
BAP_PUBLIC_HOST=http://localhost docker compose --env-file .env -f compose.yaml -f compose.development.yaml -f compose.mailpit.yaml up --build
```

## Production model

```sh
docker compose --env-file /path/to/runtime.environment -f compose.yaml -f compose.production.yaml up -d --build
```

The delivered topology is Caddy on the public edge, with web on the internal
application and data networks plus the non-internal `internet-egress` network,
and both Nest APIs on internal application and data networks only. The
background worker joins the data, `internet-egress`, and internal `scan`
networks and never the application network. `clamd` joins only `scan`, so the
worker is its single client, and `freshclam` joins only `internet-egress` to
refresh the shared `clamav_signatures` volume, which `clamd` mounts read-only.
PostgreSQL joins only the internal data network. Caddy blocks `/ready` and
`/metrics` before proxying and is the only published application entry point.
Web, the worker, and `freshclam` take their default route from `internet-egress`
so mail, AI provider, and signature mirror calls leave the host; that access is
unrestricted outbound connectivity, not a destination allowlist. Dedicated
`operations-egress` access is limited to one-shot restic clients and is
unrestricted outbound connectivity while they run, not a destination allowlist.
Production Caddy enables TLS when the owner supplies a valid public host,
origin, DNS, and ACME reachability.

Application images use Node.js 24.21.0, frozen pnpm dependencies, non-root
runtime users, dropped Linux capabilities, and health checks. The operations
image has a root-only credential staging wrapper with four explicit
capabilities, then executes every networked restic and PostgreSQL client as UID
999 with zero effective capabilities. Its mode `0400` credential copies exist
only in a dedicated tmpfs. The read-only web container has an ephemeral writable
Next.js cache. PostgreSQL 18 stores data under a named volume mounted at
`/var/lib/postgresql`, which is the official image path for version 18 and
newer. The `upload_staging` volume is mounted read-write at
`/var/lib/bap/uploads` into the application API and the worker and into no other
service. The `blob_storage` volume holds every organization's durable originals
at `/var/lib/bap/blobs`: the application API and the worker mount it read-write,
the `backup` one-shot read-only, the `restore` one-shot read-write, and no other
service at all. `scripts/verify-compose.mjs` asserts both member sets and the
mode of every blob mount. Caddy caps a request body at 25MB, except under
`/api/inbound/*`, where the cap is 30MB so a Mailgun post carrying a 25MB
message plus form overhead is not bounced at the edge; the application API
rejects an upload or an email by the bytes it received rather than by any proxy
or client claim.

Both ClamAV services run the pinned `clamav/clamav:1.5.4` image (Docker Hub
publishes it for amd64 only, so `platform: linux/amd64` is declared and an Apple
Silicon host runs it under emulation) as UID 100 with a read-only root, no
capabilities, tmpfs at `/run/clamav` and `/tmp`, and a read-only bind of
`infrastructure/clamav/clamd.conf` or `freshclam.conf`. The daemons run
directly, not through the image entrypoint, which expects a writable root.
`clamdscan --ping` is the `clamd` health check; the presence of `main.cvd` or
`main.cld` in the volume is the `freshclam` health check. `freshclam` never
notifies `clamd` (no route between them); `clamd` reloads a changed signature
set through its own `SelfCheck` every 600 seconds.

Use `docker compose stop` for routine shutdown. Never add `down -v` to a normal
workflow because it removes the database volume.

## Inbound email

Inbound email reaches BAP through a Mailgun EU inbound route; the recipient
address alone binds a message to a channel.

First boot. A new `clamav_signatures` volume is seeded from the signatures baked
into the image, then `freshclam` refreshes it; `clamd` waits for `freshclam` to
report a populated volume and loads signatures for a minute or two. Wait until
`docker compose ps` shows both healthy before creating the first email channel;
until then the worker's scan step fails and pg-boss retries the job. If the
volume was created while the mirror was unreachable, run
`docker compose run --rm freshclam --config-file=/etc/clamav/freshclam.conf`
once and restart `clamd`.

Mailgun setup, in the EU region:

1. Set `BAP_INTAKE_DOMAIN` to the intake domain, for example `in.<your-host>`,
   and add it as a receiving domain in the Mailgun EU dashboard.
2. Publish two MX records for that domain, priority 10 `mxa.eu.mailgun.org` and
   priority 10 `mxb.eu.mailgun.org`, plus the TXT records Mailgun asks for.
3. Create one route with filter `match_recipient(".*@<domain>")` and action
   `forward("https://<host>/api/inbound/mailgun/mime")`. The URL must end with
   `mime`; otherwise Mailgun posts parsed fields and omits the raw message.
4. Copy the account's Webhook Signing Key from the Mailgun EU dashboard
   (Sending, Webhooks) into the file `BAP_MAILGUN_WEBHOOK_SIGNING_KEY_FILE`
   names, one line, mode `0600`, and restart `web`.

The route answers 406 for an unknown recipient so Mailgun stops retrying, and
502 for an upstream failure so it retries for eight hours. Nothing about the
message is logged.

## Delivered and deferred operations

Delivered: pinned images, Caddy reverse proxy, secret-file mounts, database role
bootstrap and migrations, health checks, private readiness and metrics routes,
and an isolated restic backup and restore proof.

Owner-dependent: production secret distribution, DNS and TLS issuance, off-host
restic storage and its backend-specific credentials and trust files, recurring
production backup scheduling and retention, monitoring collection and alerts,
deployment automation, RPO/RTO commitments, and recovery ownership. These
require a real operating environment and are not configured by this repository.
