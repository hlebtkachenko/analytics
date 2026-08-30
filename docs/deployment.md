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
BAP_PUBLIC_HOST=http://localhost docker compose --env-file .env -f compose.yaml -f compose.development.yaml up --build
```

## Production model

```sh
docker compose --env-file /path/to/runtime.environment -f compose.yaml -f compose.production.yaml up -d --build
```

The delivered topology is Caddy on the public edge, with web on the internal
application and data networks plus the non-internal `internet-egress` network,
and both Nest APIs on internal application and data networks only. The
background worker joins the data and `internet-egress` networks and never the
application network. PostgreSQL joins only the internal data network. Caddy
blocks `/ready` and `/metrics` before proxying and is the only published
application entry point. Web and the worker take their default route from
`internet-egress` so mail and AI provider calls leave the host; that access is
unrestricted outbound connectivity, not a destination allowlist. Dedicated
`operations-egress` access is limited to one-shot restic clients and is
unrestricted outbound connectivity while they run, not a destination allowlist.
Production Caddy enables TLS when the owner supplies a valid public host,
origin, DNS, and ACME reachability.

Application images use Node.js 24.20.0, frozen pnpm dependencies, non-root
runtime users, dropped Linux capabilities, and health checks. The operations
image has a root-only credential staging wrapper with four explicit
capabilities, then executes every networked restic and PostgreSQL client as UID
999 with zero effective capabilities. Its mode `0400` credential copies exist
only in a dedicated tmpfs. The read-only web container has an ephemeral writable
Next.js cache. PostgreSQL 18 stores data under a named volume mounted at
`/var/lib/postgresql`, which is the official image path for version 18 and
newer.

Use `docker compose stop` for routine shutdown. Never add `down -v` to a normal
workflow because it removes the database volume.

## Delivered and deferred operations

Delivered: pinned images, Caddy reverse proxy, secret-file mounts, database role
bootstrap and migrations, health checks, private readiness and metrics routes,
and an isolated restic backup and restore proof.

Owner-dependent: production secret distribution, DNS and TLS issuance, off-host
restic storage and its backend-specific credentials and trust files, recurring
production backup scheduling and retention, monitoring collection and alerts,
deployment automation, RPO/RTO commitments, and recovery ownership. These
require a real operating environment and are not configured by this repository.
