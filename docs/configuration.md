# Configuration

## Public and Compose inputs

`config/compose.environment.example` is the complete non-secret Compose input
template. Copy it to an ignored file for local development.

| Variable            | Purpose                                    | Development default     |
| ------------------- | ------------------------------------------ | ----------------------- |
| `WEB_PORT`          | Caddy host port                            | `3000`                  |
| `POSTGRES_PORT`     | Loopback PostgreSQL host port              | `5432`                  |
| `POSTGRES_DB`       | Database name                              | `bap`                   |
| `BAP_PUBLIC_HOST`   | Caddy site address                         | `http://localhost`      |
| `BAP_PUBLIC_ORIGIN` | Exact Better Auth issuer and public origin | `http://localhost:3000` |

`BAP_PUBLIC_ORIGIN` must be an origin without a path. It is never a
`NEXT_PUBLIC_*` value. Production accepts HTTPS origins, with plain HTTP
restricted to local loopback development.

The committed template uses production-shaped host and origin values. Override
`BAP_PUBLIC_HOST` to `http://localhost` for the development Compose stack; its
overlay sets the matching local origin from `WEB_PORT`.

## Runtime configuration

Compose provides service hosts, ports, database login names, and credential file
paths. These are internal runtime values, not user configuration.

- Web uses `BAP_DATABASE_*` and `BETTER_AUTH_SECRET_FILE`. Its two BFF targets
  are fixed internal service origins, not deployment inputs.
- Application and reporting APIs use `BAP_DATABASE_*`, `BAP_JWKS_URL`, and
  `BAP_PUBLIC_ORIGIN`.
- Web listens on `PORT` with `HOSTNAME`; Nest services validate `PORT` and
  `HOST` at startup.
- Caddy provides the only public application port and replaces client identity
  with `X-BAP-Client-IP`.

Next.js telemetry is disabled in container builds and runtimes.

## Secret files

Compose accepts paths, never literal passwords. The required local file names
are the PostgreSQL administrator, migrator, auth, application, reporting,
backup, Better Auth, and restic credential files listed in
`config/compose.environment.example`. Create disposable local values with:

```sh
pnpm secrets:local
```

The command writes ignored files under `.secrets` with restrictive permissions.
Production secret values and paths are owner-managed deployment inputs. The
delivered restic contract contains only an encrypted repository locator and
password for local proof. An off-host backend needs fixed, backend-specific
credential and trust-file mounts after the owner selects that backend. Generic
credential files are not sourced or parsed.

Do not introduce `NEXT_PUBLIC_*` variables for server credentials or internal
service locations. Production secrets must be injected by the deployment
environment and must never enter an image layer or Git.

## Dependency policy

Shared versions are exact entries in `pnpm-workspace.yaml`. pnpm enforces strict
peers, rejects workspace cycles, delays new releases for 24 hours unless
explicitly reviewed, and runs dependency build scripts only for the reviewed
allowlist. Update the catalog and lockfile together.
