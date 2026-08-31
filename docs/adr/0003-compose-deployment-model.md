# ADR 0003: Compose Deployment Model

- Status: accepted
- Date: 2026-08-28

## Context

Developers need local infrastructure and production-parity containers. A
production host also needs explicit security and persistence behavior.

## Decision

Use `compose.yaml` as the canonical service model. Apply
`compose.development.yaml` for loopback-published local ports and
`compose.mailpit.yaml` separately for the local synthetic-mail sink. Apply
`compose.production.yaml` for restart and read-only application policies. Owner
bootstrap deliberately uses base plus development without the mail overlay.
Build each application from its own multi-stage Dockerfile, run Node.js as a
non-root user, and persist PostgreSQL 18 under a named volume mounted at
`/var/lib/postgresql`.

## Consequences

All environments share the canonical application definitions and health checks.
The separately selected mail overlay keeps its SMTP override, loopback proxy,
and network out of bootstrap, production, and operations models. Production
ingress, TLS, secret injection, backups, and deployment automation remain
explicit later decisions rather than hidden assumptions.
