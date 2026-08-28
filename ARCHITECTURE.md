# BAP Architecture

## Scope

BAP is organized as 3 independently deployable TypeScript applications with a
PostgreSQL 18 service. This foundation supplies build, test, runtime, and
container boundaries. Domain modules, persistence ownership, authentication,
authorization, tenancy, and external integrations are intentionally deferred.

## System context

```mermaid
C4Context
  title System Context - Business Analytics Platform

  Person(user, "Platform user", "Uses BAP through a web browser")
  System(bap, "Business Analytics Platform", "Web and API foundation for business analytics capabilities")

  Rel(user, bap, "Uses", "HTTPS")
```

## Containers

```mermaid
C4Container
  title Container Diagram - Business Analytics Platform

  Person(user, "Platform user", "Uses BAP through a web browser")

  Container_Boundary(bap, "Business Analytics Platform") {
    Container(web, "Web application", "Next.js, React, TypeScript", "Renders the browser application and exposes web health state")
    Container(api, "Application API", "NestJS, TypeScript", "Hosts application-facing API modules")
    Container(reporting, "Reporting API", "NestJS, TypeScript", "Hosts reporting workloads behind an independent runtime boundary")
    ContainerDb(database, "Database", "PostgreSQL 18", "Provides persistence infrastructure for future owned schemas")
  }

  Rel(user, web, "Uses", "HTTPS")
  Rel(web, api, "Will call application endpoints", "JSON/HTTPS")
  Rel(web, reporting, "Will request reporting operations", "JSON/HTTPS")
  Rel(api, database, "Will access owned application data", "PostgreSQL protocol")
  Rel(reporting, database, "Will access approved reporting data", "PostgreSQL protocol")
```

The API-to-database relations describe the intended container boundary. No
database client, schema, or query exists yet because persistence requirements
have not been selected.

## Workspace dependency rules

```mermaid
flowchart TD
  web[apps/web]
  api[apps/api]
  reporting[apps/reporting-api]
  eslint[packages/eslint-config]
  typescript[packages/typescript-config]

  web --> eslint
  web --> typescript
  api --> eslint
  api --> typescript
  reporting --> eslint
  reporting --> typescript
```

Applications do not import one another. Packages cannot import applications. The
repository intentionally has no generic `shared`, `common`, `contracts`, or
domain package.

## Deployment

```mermaid
C4Deployment
  title Deployment - Container Host

  Deployment_Node(host, "Container host", "Docker Engine with Compose") {
    Container(web, "Web application", "Next.js standalone server", "Non-root Node.js process")
    Container(api, "Application API", "Compiled NestJS", "Non-root Node.js process")
    Container(reporting, "Reporting API", "Compiled NestJS", "Non-root Node.js process")
    ContainerDb(database, "Database", "PostgreSQL 18.6", "Persistent named volume")
  }
```

The canonical Compose model is `compose.yaml`. Development and production files
add explicit host bindings and runtime policies. PostgreSQL is never published
by the production model.

## Operational map

| Process         |  Default port | Health endpoint | Build artifact                                         |
| --------------- | ------------: | --------------- | ------------------------------------------------------ |
| Web             |          3000 | `GET /health`   | Next.js standalone output                              |
| Application API |          3001 | `GET /health`   | `apps/api/dist` plus production dependencies           |
| Reporting API   |          3002 | `GET /health`   | `apps/reporting-api/dist` plus production dependencies |
| PostgreSQL      | 5432 internal | `pg_isready`    | `postgres:18.6-bookworm` with named volume             |

## Deferred decisions

Phase 4 owns decisions for authentication, authorization, tenancy, database
access, migrations, observability, queues, caching, ingress, deployment
automation, secrets management, backups, and SaaS operations.
