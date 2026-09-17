# Configuration

## Public and Compose inputs

`config/compose.environment.example` is the complete non-secret Compose input
template. Copy it to an ignored file for local development.

| Variable                                | Purpose                                                             | Development default      |
| --------------------------------------- | ------------------------------------------------------------------- | ------------------------ |
| `WEB_PORT`                              | Caddy host port                                                     | `3000`                   |
| `POSTGRES_PORT`                         | Loopback PostgreSQL host port                                       | `5432`                   |
| `MAILPIT_HTTP_PORT`                     | Unique loopback mail-inspection port                                | `8025`                   |
| `POSTGRES_DB`                           | Database name                                                       | `bap`                    |
| `BAP_PUBLIC_HOST`                       | Caddy site address                                                  | `http://localhost`       |
| `BAP_PUBLIC_ORIGIN`                     | Exact Better Auth issuer and public origin                          | `http://localhost:3000`  |
| `BAP_MAIL_SENDER`                       | From address for transactional mail                                 | `no-reply@bap.localhost` |
| `BAP_MAIL_TRANSPORT`                    | Explicit `resend`, `smtp`, or `log` mode                            | `smtp` in development    |
| `BAP_BLOB_QUOTA_BYTES_PER_ORGANIZATION` | Platform default and cap for the per-organization stored blob quota | `1073741824`             |
| `BAP_INTAKE_DOMAIN`                     | Domain of every issued inbox email address                          | `in.bap.localhost`       |
| `BAP_INBOUND_MAX_IN_FLIGHT`             | Concurrent Mailgun posts web accepts before answering 503           | `4`                      |

`BAP_PUBLIC_ORIGIN` must be an origin without a path. It is never a
`NEXT_PUBLIC_*` value. Production accepts HTTPS origins, with plain HTTP
restricted to local loopback development.

The committed template uses production-shaped host and origin values. Override
`BAP_PUBLIC_HOST` to `http://localhost` for the development Compose stack; its
overlay sets the matching local origin from `WEB_PORT`. Select
`compose.mailpit.yaml` explicitly for local mail delivery and inspection.
`MAILPIT_HTTP_PORT` may be any integer from 1 through 65535, but it cannot equal
the web or PostgreSQL host port.

`BAP_BLOB_QUOTA_BYTES_PER_ORGANIZATION` is a positive integer of bytes and is
the platform default and cap. The application API refuses an upload that would
take the sum of an organization's `app.blob.byte_size` above the effective
quota, before any byte is committed
([ADR 0014](adr/0014-durable-blob-storage.md)). An owner can only tighten the
quota per organization, on `/inbox/settings`; the effective quota is the lesser
of the organization setting and this variable. No new environment variable backs
the per-organization setting; it is stored in `app.organization_inbox_setting`.

`BAP_INTAKE_DOMAIN` is the bare DNS name (no scheme, no `@`) whose MX records
point at Mailgun EU; every email channel address is `in-<token>@<domain>`. The
production overlay requires it, because the value is written into stored
addresses. `BAP_INBOUND_MAX_IN_FLIGHT` is an integer from 1 through 64 (default
`4`); a post beyond it answers 503 so Mailgun retries later.

## Runtime configuration

Compose provides service hosts, ports, database login names, and credential file
paths. These are internal runtime values, not user configuration.

- Web uses `BAP_DATABASE_*`, `BETTER_AUTH_SECRET_FILE`, `BAP_MAIL_SENDER`,
  `BAP_MAIL_TRANSPORT`, `BAP_RESEND_API_KEY_FILE`, `BAP_MAIL_SMTP_HOST`,
  `BAP_MAIL_SMTP_PORT`, and `BAP_AI_PROVIDER_CONFIG_FILE`. Its two BFF targets
  are fixed internal service origins, not deployment inputs. The Mailgun webhook
  reads `BAP_MAILGUN_WEBHOOK_SIGNING_KEY_FILE`
  (`/run/credentials/mailgun-webhook-signing-key`, the mounted
  `mailgun_webhook_signing_key` secret) once, on the first post, and never
  echoes it; the file must be a protected regular file with mode `0400`, `0444`,
  or `0600`, plus `BAP_INTAKE_DOMAIN` and `BAP_INBOUND_MAX_IN_FLIGHT`.
- Organization route resolution reuses the `bap_auth` pool and has no separate
  database role, endpoint, cache, or runtime configuration. The Phase 10 quota
  display reuses that pool's existing SELECT-only quota access and adds no
  runtime input or credential.
- Application and reporting APIs use `BAP_DATABASE_*`, `BAP_JWKS_URL`, and
  `BAP_PUBLIC_ORIGIN`. The application API also uses `BAP_UPLOAD_STAGING_DIR`,
  which must name the mounted upload staging volume, `BAP_BLOB_STORAGE_DIR`,
  which must name the mounted `blob_storage` volume (`/var/lib/bap/blobs`),
  `BAP_BLOB_QUOTA_BYTES_PER_ORGANIZATION`, and `BAP_INTAKE_DOMAIN`, which it
  passes to `auth.issue_channel_credential` when an email address is issued.
  Blob keys are `org/<organization_id>/<sha256>` under that directory. The
  volume root is owned by the API user with group `999` and the setgid bit, and
  the `BlobStore` must create directories with mode `0770` and files with mode
  `0660` (Node masks a requested mode with the process umask, so set the umask
  to `0007` or `chmod` after creation): the backup and restore one-shots run as
  UID `999` with no capabilities, and only group access lets them read every
  original and lets the API keep writing into a restored prefix.
- Owner bootstrap runs the same web image and therefore builds the same auth
  instance. Its primary database path remains `bap_auth`, while the profiled
  one-shot also receives `BAP_MIGRATOR_PASSWORD_FILE` at a separate mount only
  to establish the minimum initial organization quota. That migrator pool closes
  before organization creation. The service sets `BAP_MAIL_TRANSPORT` to `log`,
  never sends mail, and mounts no provider credential. Long-lived web has no
  migrator variable or mount. `BAP_RESEND_API_KEY_FILE` is required only for the
  `resend` transport.
- The worker uses `BAP_DATABASE_*` as `bap_api` plus
  `BAP_AI_PROVIDER_CONFIG_FILE`, `BAP_UPLOAD_STAGING_DIR`, and the same
  `BAP_BLOB_STORAGE_DIR` and `BAP_BLOB_QUOTA_BYTES_PER_ORGANIZATION` as the
  application API, and serves health, readiness, and metrics on its own internal
  port. It scans inbound email through `BAP_CLAMAV_HOST` and `BAP_CLAMAV_PORT`
  (`clamd:3310` over the internal `scan` network, INSTREAM protocol); the values
  are fixed service coordinates, not deployment inputs.
- `clamd` and `freshclam` read only their bind-mounted
  `infrastructure/clamav/*.conf`; there is no environment input. `clamd` caps a
  stream at 30 MB, a file at 25 MB, a scan at 60 MB and 60 seconds, ten levels
  of nesting and 200 files, and alerts when a cap is exceeded, so an archive
  bomb reads as a detection rather than a timeout.
- Web listens on `PORT` with `HOSTNAME`; Nest services validate `PORT` and
  `HOST` at startup.
- Caddy provides the only public application port and replaces client identity
  with `X-BAP-Client-IP`.

The `organization-quota --email --total --note` operator command reuses the
existing migrator service and credential. It introduces no environment variable
or secret. Its required note is stored as quota provenance; `granted_by` remains
NULL because a host operator is not an `auth.user`.

Next.js telemetry is disabled in container builds and runtimes.

## Secret files

Compose accepts paths, never literal passwords. The required local file names
are the PostgreSQL administrator, migrator, auth, application, reporting,
backup, Better Auth, Resend, AI provider, Mailgun webhook signing key, and
restic credential files listed in `config/compose.environment.example`. The
Resend key and the AI provider document are seeded with the literal placeholder
`local-development-placeholder`, and the AI credential refuses it too, so no
model call leaves a development machine by accident. The Mailgun signing key is
seeded with a random value so a local client can sign a webhook post the way
Mailgun does; production takes the Webhook Signing Key from the Mailgun EU
dashboard. The mail transport is never inferred from that value:
`BAP_MAIL_TRANSPORT` selects it explicitly. Production uses `resend`, which
refuses an absent or placeholder key. The separately selected Mailpit overlay
sets `smtp` with the exact `mailpit:1025` endpoint. The schema rejects every
other SMTP host or port. The SMTP client fixes DNS, connection, greeting, and
socket timeouts to 1, 1.5, 1.5, and 2 seconds, and disables file and URL access.
Those are independent fail-fast settings, not a total delivery bound.
Verification through the development SMTP sink is awaited at the auth response
boundary; production Resend remains non-blocking. Production, operations, and
bootstrap Compose contain neither the sink nor its SMTP variables, so cleartext
unauthenticated SMTP is limited to the isolated development/CI network. The
`log` transport remains an explicit option for non-sending one-shot runtimes and
deliberately prints message content if it is ever used. Create disposable local
values with:

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

## AI provider credential

The `ai_provider_config` document declares the providers a deployment may reach
and the model each role uses. `providers` maps a supported provider name,
`anthropic` or `openai`, to its own `apiKey` and optional `baseUrl`. `models`
maps a role to the `provider` that serves it and the `model` name that provider
knows. No provider serves every role, so the two maps are separate: a deployment
that wants Claude for conversation still needs OpenAI for embeddings, because
Anthropic publishes no embedding model.

```json
{
  "providers": {
    "anthropic": { "apiKey": "REPLACE_WITH_ANTHROPIC_KEY" },
    "openai": { "apiKey": "REPLACE_WITH_OPENAI_KEY" }
  },
  "models": {
    "chat": { "provider": "anthropic", "model": "claude-sonnet-5" },
    "embedding": { "provider": "openai", "model": "text-embedding-3-small" },
    "summary": { "provider": "anthropic", "model": "claude-sonnet-5" }
  }
}
```

Three roles are used today: `chat` for the streaming assistant, `embedding` for
dataset embeddings, and `summary` for dataset summarization. A role the
credential does not name leaves that one feature off and leaves the rest of the
platform working. A role naming a provider that `providers` omits is rejected
when the credential is loaded, not when the model is first called. At least one
provider must be configured, unknown provider names and unknown fields are
refused, and a `baseUrl` must be an `http` or `https` origin. Validation errors
report field paths only, so no key value is ever echoed.

Embedding width is not a credential input. `app.dataset_embedding.embedding` is
`vector(1536)`, the job requests exactly that width from the provider, and a
vector of any other width is rejected before it reaches PostgreSQL. Naming an
embedding model that cannot produce 1536 components therefore fails the backfill
rather than corrupting the store.

## Dependency policy

Shared versions are exact entries in `pnpm-workspace.yaml`. pnpm enforces strict
peers, rejects workspace cycles, delays new releases for 24 hours unless
explicitly reviewed, and runs dependency build scripts only for the reviewed
allowlist. Update the catalog and lockfile together.
