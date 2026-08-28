# Deployment

## Validate models

```sh
POSTGRES_PASSWORD=local-validation-only pnpm compose:config
POSTGRES_PASSWORD=local-validation-only pnpm compose:config:production
```

## Local production-parity stack

```sh
cp config/compose.environment.example .env
docker compose --env-file .env -f compose.yaml -f compose.development.yaml up --build
```

## Production model

```sh
docker compose --env-file /path/to/runtime.environment -f compose.yaml -f compose.production.yaml up -d --build
```

The production model binds application ports to loopback by default and does not
publish PostgreSQL. A reverse proxy, TLS, backup policy, secret provider, and
deployment automation are phase 4 decisions. Do not expose this phase 1 model
directly to the public internet.

Application images use Node.js 24.20.0, frozen pnpm dependencies, non-root
runtime users, dropped Linux capabilities, and health checks. The read-only web
container has an ephemeral writable Next.js cache. PostgreSQL 18 stores data
under a named volume mounted at `/var/lib/postgresql`, which is the official
image path for version 18 and newer.

Use `docker compose stop` for routine shutdown. Never add `down -v` to a normal
workflow because it removes the database volume.
