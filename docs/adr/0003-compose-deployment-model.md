# ADR 0003: Compose Deployment Model

- Status: accepted
- Date: 2026-08-28

## Context

Developers need local infrastructure and production-parity containers. A
production host also needs explicit security and persistence behavior.

## Decision

Use `compose.yaml` as the canonical service model. Apply
`compose.development.yaml` for loopback-published local ports and
`compose.production.yaml` for restart and read-only application policies. Build
each application from its own multi-stage Dockerfile, run Node.js as a non-root
user, and persist PostgreSQL 18 under a named volume mounted at
`/var/lib/postgresql`.

## Consequences

Both environments share the same service definitions and health checks.
Production ingress, TLS, secret injection, backups, and deployment automation
remain explicit later decisions rather than hidden assumptions.
