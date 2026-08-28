# Security Baseline

This repository is public. Source, tests, documentation, issues, and build
artifacts must contain no real personal, customer, company, financial,
credential, or analytics data.

## Repository rules

- Commit only synthetic, clearly non-production examples.
- Keep environment files, credentials, certificates, keys, dumps, exports, local
  databases, logs, and test artifacts ignored.
- Never copy environment files into container build contexts.
- Keep PostgreSQL off the public edge and on the internal data network.
- Run applications as non-root container users with dropped capabilities.
- Pin toolchain and container patch versions.
- Validate external input at its first trusted boundary.
- Do not enable wildcard production CORS.

CI runs focused formatting, lint, type, test, build, secret, dependency, and
static-analysis checks. The scheduled operational proof adds a disposable
browser and backup/restore exercise. Automated scans do not replace manual
review of configuration, workflows, fixtures, container files, and generated
artifacts before every push.

## Runtime boundary

Caddy is the sole public entry point. It blocks `/ready` and `/metrics` before
proxying, replaces the dedicated client-IP header, and forwards only intended
application traffic. The web service, both APIs, and PostgreSQL communicate on
internal Compose networks. Health is intentionally public; readiness and
Prometheus metrics are operational-only routes.

Better Auth uses opaque secure cookies for browser identity. Resource JWTs are
signed only inside the server-side BFF, expire after five minutes, and are never
returned to browser code. The test-only synthetic-account CLI is explicitly
gated by `BAP_E2E_SETUP=true`; do not set that variable in a normal runtime.

Do not publish a vulnerability report containing secrets or personal data. Use
GitHub's enabled private vulnerability reporting channel.
