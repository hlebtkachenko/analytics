# BAP Architecture

## Scope

BAP is organized as 3 independently deployable TypeScript applications behind
Caddy with PostgreSQL 18 persistence. The foundation implements identity,
organization access, database isolation, observability, migration, backup, and
container boundaries. Analytics and other product modules remain out of scope.

## System context

```mermaid
C4Context
  title System Context - Business Analytics Platform

  Person(user, "Platform user", "Uses BAP through a web browser")
  System(bap, "Business Analytics Platform", "Web and API foundation for business analytics capabilities")
  System_Ext(dns, "Public DNS and ACME", "Resolves the owner-provided hostname and issues TLS certificates")

  Rel(user, bap, "Uses", "HTTPS")
  Rel(bap, dns, "Obtains certificates", "DNS and HTTPS")
```

## Containers

```mermaid
C4Container
  title Container Diagram - Business Analytics Platform

  Person(user, "Platform user", "Uses BAP through a web browser")

  Container_Boundary(bap, "Business Analytics Platform") {
    Container(caddy, "Ingress", "Caddy", "Terminates TLS and is the only public peer")
    Container(web, "Web application", "Next.js, Better Auth, Carbon", "Owns browser sessions, identity endpoints, and fixed BFF routes")
    Container(api, "Application API", "NestJS, JOSE", "Validates resource JWTs and resolves application organization access")
    Container(reporting, "Reporting API", "NestJS, JOSE", "Validates resource JWTs and resolves reporting organization access")
    ContainerDb(database, "Database", "PostgreSQL 18", "Stores identity state, migration metadata, and tenant-isolation policies")
  }

  Rel(user, caddy, "Uses", "HTTPS")
  Rel(caddy, web, "Forwards public routes", "HTTP on app network")
  Rel(web, api, "Calls one fixed application access route", "Short-lived JWT over HTTP")
  Rel(web, reporting, "Calls one fixed reporting access route", "Short-lived JWT over HTTP")
  Rel(web, database, "Uses bap_auth role", "PostgreSQL protocol")
  Rel(api, database, "Executes membership resolver as bap_api", "PostgreSQL protocol")
  Rel(reporting, database, "Executes membership resolver as bap_reporting", "PostgreSQL protocol")
  Rel(api, web, "Refreshes public signing keys", "JWKS")
  Rel(reporting, web, "Refreshes public signing keys", "JWKS")
```

The browser receives only opaque Better Auth cookies. Resource JWTs exist only
inside a fixed BFF-to-service request and contain `iss`, `aud`, `sub`, `iat`,
and `exp`. No catch-all proxy or browser Bearer-token flow exists.

Account deletion hard-deletes the Better Auth identity after a sole-owner guard
records its explicit id in an auth-schema pending request. The web role never
crosses into schema `app`. A one-shot operator command later assumes the NOLOGIN
`bap_eraser` role inside 1 transaction, anonymizes only the 3 approved subject
columns behind forced RLS, consumes the request, and retains no raw-id mapping.
It refuses live and unrequested identities.

Organization creation quota is durable auth-schema state separate from
membership. A database trigger serializes non-NULL creator-attributed inserts
with a transaction advisory lock and enforces count against quota atomically.
NULL identifies an unattributed legacy or system organization and consumes no
user quota. The web role can read quota but cannot grant it. Better Auth's
enabled creation path normalizes and validates the slug before framework side
effects, injects the authenticated creator through a non-input field, and makes
that creator an owner. Its fail-closed count is a usability precheck; the
trigger remains authoritative for races.

Ten installed organization endpoints that could otherwise fall back to session
active-organization state require a bindable explicit organization id. The
eleventh, `get-active-member`, cannot bind an id and is always rejected by the
auth hook and public router. Better Auth creation and invitation acceptance may
update stored active-organization state, but no supported BAP operation uses it
as an implicit selector. Public active-organization mutation and organization
deletion are disabled. A host operator can change quota only through the
one-shot migrator CLI, which sets the owner role locally inside 1 transaction
and records a required note.

## Workspace dependency rules

```mermaid
flowchart TD
  web[apps/web]
  api[apps/api]
  reporting[apps/reporting-api]
  workbench[apps/design-system-workbench]
  design[packages/design-system]
  ai[packages/ai]
  db[packages/db]
  security[packages/security]
  eslint[packages/eslint-config]
  typescript[packages/typescript-config]

  web --> eslint
  web --> typescript
  web --> design
  web --> db
  web --> ai
  api --> eslint
  api --> typescript
  api --> db
  api --> security
  reporting --> eslint
  reporting --> typescript
  reporting --> db
  reporting --> security
  workbench --> eslint
  workbench --> typescript
  workbench --> design
```

Applications do not import one another. Packages cannot import applications.
`@bap/db` is the only database boundary, `@bap/security` owns service-neutral
JWT/access contracts, and `@bap/design-system` is the only UI library. `@bap/ai`
owns the model-provider boundary, and the web streaming chat route is its only
application consumer.

The design-system workbench is a development and static-reference application,
not a production container. It consumes only public `@bap/design-system`
entrypoints and verifies the generated Carbon catalog, executable stories, and
offline handbook against the pinned upstream release.

## Deployment

```mermaid
C4Deployment
  title Deployment - Container Host

  Deployment_Node(host, "Container host", "Docker Engine with Compose") {
    Container(caddy, "Ingress", "Pinned Caddy image", "Only host ports 80 and 443")
    Container(web, "Web application", "Next.js standalone server", "Non-root Node.js process")
    Container(api, "Application API", "Compiled NestJS", "Non-root Node.js process")
    Container(reporting, "Reporting API", "Compiled NestJS", "Non-root Node.js process")
    ContainerDb(database, "Database", "PostgreSQL 18.6", "Persistent named volume")
    Container(bootstrap, "Bootstrap and migrator", "Image-local one-shot commands", "Creates roles, then applies reviewed SQL")
    Container(backup, "Backup operations", "Pinned PostgreSQL client and restic", "Encrypted backup, check, prune, and isolated restore")
  }
```

The production model has non-internal `edge`, internal `app`, internal `data`,
and non-internal `internet-egress` and `operations-egress` networks. Caddy is
the only published service. Only the web application and the background worker
join `internet-egress`, where they reach mail and AI providers; the application
API and the reporting API deliberately keep no outbound path. Only one-shot
restic clients join `operations-egress`; backup and restore also join `data`.
Each runtime mounts only its own credential files. Caddy certificate state and
PostgreSQL data use named volumes. A third named volume stages uploaded files
between the application API and the worker; it is mounted into that pair and
into no other service, which `scripts/verify-compose.mjs` asserts. Backup
scheduling, backend-specific credentials, and off-host durability require owner
configuration.

The profiled owner-bootstrap service is the only dual-tier exception: it mounts
the auth credential used by Better Auth and a separate migrator credential used
only to establish the minimum initial organization quota. The migrator pool is
closed before the organization API call. The gated operational synthetic setup
runs as a command override of this one-shot service. Long-lived web has neither
the migrator environment path nor its secret mount.

The general organization-quota command runs in the existing one-shot migrator
service. It has no auth credential, web route, or long-lived process and returns
only the resulting quota row as JSON.

Organization slugs are resolved only in the Next.js web tier. The dynamic layout
validates the slug, requires a verified browser session, and calls a narrow
`@bap/db` accessor which joins `auth.organization` to `auth.member` by slug and
session user id through `bap_auth`. React `cache` deduplicates that whole
resolution within 1 request only. Every negative or failed lookup becomes the
same 404, and no slug-to-id mapping is cached across requests. The BFF,
application API, reporting API, RLS context, and service membership resolver
remain id-only. The root route redirects to `/organizations`; that index and the
first descendant `[orgSlug]` page arrive in Phase 10, so both targets remain 404
in the Phase 9 routing foundation.

The separately selected development and operational-proof Mailpit overlay adds 1
ephemeral sink on the `app` network. Web sends to its internal cleartext SMTP
port and awaits verification-message acceptance before returning the development
auth response; production Resend remains non-blocking. A non-root, read-only
companion exposes only GET `/readyz` and GET `/api/v1/search` on host loopback;
every other path and method returns 404. It runs with every capability dropped
and no additions. The public Caddy configuration has no Mailpit route. Mailpit
has no provider credential, persistent volume, or production service. Bootstrap
omits the overlay, and production mail continues through Resend on
`internet-egress`.

## Operational map

| Process           | Internal port | Public surface            | Private readiness |
| ----------------- | ------------: | ------------------------- | ----------------- |
| Caddy             |       80, 443 | All browser traffic       | Config validation |
| Web               |          3000 | `GET /health`             | `GET /ready`      |
| Application API   |          3001 | None                      | `GET /ready`      |
| Reporting API     |          3002 | None                      | `GET /ready`      |
| PostgreSQL        |          5432 | Development loopback      | `pg_isready`      |
| Mailpit           |    1025, 8025 | None                      | `GET /readyz`     |
| Mailpit API proxy |          8025 | Development loopback only | `GET /readyz`     |

## Deliberately deferred

SSO, distributed caches or limits, OpenTelemetry, PDF export, billing, uploads
to object storage, HA, registry publishing, deployment automation, and product
schemas require real owner or product requirements. See
[the approved SaaS foundation plan](docs/planning/saas-foundation.md) and
[the platform batteries plan](docs/planning/platform-batteries.md).
