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
owns the model-provider boundary and has no application consumer yet, so no
application edge points at it.

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

## Operational map

| Process         | Internal port | Public surface       | Private readiness |
| --------------- | ------------: | -------------------- | ----------------- |
| Caddy           |       80, 443 | All browser traffic  | Config validation |
| Web             |          3000 | `GET /health`        | `GET /ready`      |
| Application API |          3001 | None                 | `GET /ready`      |
| Reporting API   |          3002 | None                 | `GET /ready`      |
| PostgreSQL      |          5432 | Development loopback | `pg_isready`      |

## Deliberately deferred

SSO, distributed caches or limits, OpenTelemetry, PDF export, billing, uploads
to object storage, HA, registry publishing, deployment automation, and product
schemas require real owner or product requirements. See
[the approved SaaS foundation plan](docs/planning/saas-foundation.md) and
[the platform batteries plan](docs/planning/platform-batteries.md).
