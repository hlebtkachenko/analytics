# Configuration

## Application variables

| Variable   | Process         | Default                 | Validation                   |
| ---------- | --------------- | ----------------------- | ---------------------------- |
| `PORT`     | Web             | 3000                    | Next.js runtime              |
| `HOSTNAME` | Web             | `0.0.0.0` in containers | Next.js runtime              |
| `PORT`     | Application API | 3001                    | Integer from 1 through 65535 |
| `HOST`     | Application API | `0.0.0.0`               | Non-empty string             |
| `PORT`     | Reporting API   | 3002                    | Integer from 1 through 65535 |
| `HOST`     | Reporting API   | `0.0.0.0`               | Non-empty string             |

Next.js telemetry is disabled in container builds and runtimes.

`WEB_PORT`, `API_PORT`, and `REPORTING_API_PORT` control host port publishing
and development scripts. They are not public browser configuration.

## Compose variables

`config/compose.environment.example` documents every Compose input. Copy it to
an ignored environment file for local use. PostgreSQL requires an explicitly
provided password and does not have a committed fallback.

Do not introduce `NEXT_PUBLIC_*` variables for server credentials or internal
service locations. Production secrets must be injected by the deployment
environment and must never enter an image layer or Git.

## Dependency policy

Shared versions are exact entries in `pnpm-workspace.yaml`. pnpm enforces strict
peers, rejects workspace cycles, delays new releases for 24 hours unless
explicitly reviewed, and runs dependency build scripts only for the reviewed
allowlist. Update the catalog and lockfile together.
