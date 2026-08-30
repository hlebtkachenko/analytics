# Configuration

## Public and Compose inputs

`config/compose.environment.example` is the complete non-secret Compose input
template. Copy it to an ignored file for local development.

| Variable             | Purpose                                    | Development default      |
| -------------------- | ------------------------------------------ | ------------------------ |
| `WEB_PORT`           | Caddy host port                            | `3000`                   |
| `POSTGRES_PORT`      | Loopback PostgreSQL host port              | `5432`                   |
| `POSTGRES_DB`        | Database name                              | `bap`                    |
| `BAP_PUBLIC_HOST`    | Caddy site address                         | `http://localhost`       |
| `BAP_PUBLIC_ORIGIN`  | Exact Better Auth issuer and public origin | `http://localhost:3000`  |
| `BAP_MAIL_SENDER`    | From address for transactional mail        | `no-reply@bap.localhost` |
| `BAP_MAIL_TRANSPORT` | `resend` or the opt-in `log` transport     | `log` in development     |

`BAP_PUBLIC_ORIGIN` must be an origin without a path. It is never a
`NEXT_PUBLIC_*` value. Production accepts HTTPS origins, with plain HTTP
restricted to local loopback development.

The committed template uses production-shaped host and origin values. Override
`BAP_PUBLIC_HOST` to `http://localhost` for the development Compose stack; its
overlay sets the matching local origin from `WEB_PORT`.

## Runtime configuration

Compose provides service hosts, ports, database login names, and credential file
paths. These are internal runtime values, not user configuration.

- Web uses `BAP_DATABASE_*`, `BETTER_AUTH_SECRET_FILE`, `BAP_MAIL_SENDER`,
  `BAP_MAIL_TRANSPORT`, `BAP_RESEND_API_KEY_FILE`, and
  `BAP_AI_PROVIDER_CONFIG_FILE`. Its two BFF targets are fixed internal service
  origins, not deployment inputs.
- Application and reporting APIs use `BAP_DATABASE_*`, `BAP_JWKS_URL`, and
  `BAP_PUBLIC_ORIGIN`. The application API also uses `BAP_UPLOAD_STAGING_DIR`,
  which must name the mounted upload staging volume.
- Owner bootstrap runs the same web image and therefore builds the same auth
  instance, so it sets `BAP_MAIL_TRANSPORT` to `log`. It never sends mail and
  mounts no provider credential. `BAP_RESEND_API_KEY_FILE` is required only for
  the `resend` transport.
- The worker uses `BAP_DATABASE_*` as `bap_api` plus
  `BAP_AI_PROVIDER_CONFIG_FILE` and `BAP_UPLOAD_STAGING_DIR`, and serves health,
  readiness, and metrics on its own internal port.
- Web listens on `PORT` with `HOSTNAME`; Nest services validate `PORT` and
  `HOST` at startup.
- Caddy provides the only public application port and replaces client identity
  with `X-BAP-Client-IP`.

Next.js telemetry is disabled in container builds and runtimes.

## Secret files

Compose accepts paths, never literal passwords. The required local file names
are the PostgreSQL administrator, migrator, auth, application, reporting,
backup, Better Auth, Resend, AI provider, and restic credential files listed in
`config/compose.environment.example`. The Resend key and the AI provider
document are seeded with the literal placeholder
`local-development-placeholder`, and the AI credential refuses it too, so no
model call leaves a development machine by accident. The AI provider document
also names one model per role. Three roles are used today: `chat` for the
streaming assistant, `embedding` for dataset embeddings, and `summary` for
dataset summarization. A role the credential does not name fails that one
feature with a clear message and leaves the rest of the platform working. The
mail transport is never inferred from that value: `BAP_MAIL_TRANSPORT` selects
it explicitly, the development overlay sets `log`, and the `resend` transport
refuses to start with an absent or placeholder key so a misconfigured deployment
fails loudly instead of dropping mail. Create disposable local values with:

```sh
pnpm secrets:local
```

The command writes ignored files under `.secrets` with mode `0600`. One-shot
operations stage only their granted files as mode `0400` copies in container
tmpfs before dropping to UID 999. Database clients receive a PostgreSQL passfile
path, never a password environment variable. Production secret values and paths
are owner-managed deployment inputs. The delivered restic contract contains only
an encrypted repository locator and password for local proof. An off-host
backend needs fixed, backend-specific credential and trust-file mounts after the
owner selects that backend. Generic credential files are not sourced or parsed.

Do not introduce `NEXT_PUBLIC_*` variables for server credentials or internal
service locations. Production secrets must be injected by the deployment
environment and must never enter an image layer or Git.

## Dependency policy

Shared versions are exact entries in `pnpm-workspace.yaml`. pnpm enforces strict
peers, rejects workspace cycles, delays new releases for 24 hours unless
explicitly reviewed, and runs dependency build scripts only for the reviewed
allowlist. Update the catalog and lockfile together.
