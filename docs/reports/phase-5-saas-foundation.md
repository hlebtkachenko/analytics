# Phase 5 SaaS Foundation Report

## Delivered

The repository now has a production-oriented operational foundation without
introducing product or business logic.

- Better Auth provides opaque browser sessions, organization membership, admin
  support, and a public JWKS for service-side validation.
- The Next.js server-side BFF validates sessions and sends short-lived EdDSA
  resource JWTs only to fixed internal API routes. JWTs never enter browser
  state.
- PostgreSQL roles, schema ownership, migrations, and migration compatibility
  checks separate application access from ownership and operations.
- Caddy is the sole public edge. It controls client-IP forwarding and keeps
  readiness and Prometheus metrics private. The Next.js proxy applies a
  per-request nonce CSP.
- The web service has public health, private readiness, private metrics,
  localized authentication/access strings, and Carbon-only interface surfaces.
- An interactive, TTY-only owner bootstrap can safely complete one defined
  partial state. A separately gated synthetic-account CLI supports disposable
  operational proof only.
- Compose supplies secret-file mounts, internal networking, non-root images,
  database role bootstrap, and isolated restic backup/restore services. A
  dedicated network permits outbound access only for one-shot restic clients.
- CI includes focused security and quality checks. A scheduled/manual
  operational workflow proves browser access and one-shot backup/restore with
  disposable state.

## Tool decisions

Carbon remains the sole UI system, including charts. Better Auth is used
directly in Next.js because it supports the required session, organization,
admin, JWT, and JWKS boundaries without another identity proxy. PostgreSQL
provides durable authentication rate-limit state and authorization membership
resolution. Caddy is the deployment edge because the stack is Docker-based and
needs a compact reverse proxy with path and client-IP controls. Next.js owns the
nonce CSP.

i18next and react-i18next cover the real authentication, access, and reference
strings now present. Virtual lists, date formatting, keyboard shortcut helpers,
and syntax highlighting remain deferred until a real product workflow requires
them. The detailed dependency decisions are in
[tool decisions](../tooling/tool-decisions.md).

## Owner-dependent work

The repository deliberately does not claim deployment completion. An owner must
provide production secret distribution, public DNS, TLS/ACME reachability,
off-host restic storage, backup schedule and retention, monitoring collection,
alerting, deployment automation, recovery ownership, and RPO/RTO commitments.
These depend on the target operating environment rather than application code.

The approved plan originally named one generic backend credential file.
Implementation proved that it was a no-op because restic backends require
different variables and trust artifacts. It was removed rather than shipped as a
placeholder. Backend-specific credentials remain deferred until an off-host
backend is selected.

## Verification boundary

Local and CI checks validate code, container models, security boundaries, and
disposable operational recovery. They do not use personal, customer, business,
or production data. See [testing](../testing.md),
[authentication](../authentication.md), [deployment](../deployment.md), and
[backup and restore](../backup-and-restore.md) for executable commands and
operational limits.
