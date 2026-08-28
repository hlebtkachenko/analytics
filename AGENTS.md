# BAP Repository Instructions

## Purpose

BAP is the Business Analytics Platform. This public repository contains the
application foundation and source code, never real personal, customer,
financial, operational, or development data.

## Stack

- pnpm workspaces and Turborepo
- TypeScript 6.0.3
- Next.js App Router in `apps/web`
- NestJS application API in `apps/api`
- NestJS reporting API in `apps/reporting-api`
- PostgreSQL 18
- Docker Compose for local and production-parity execution

## Boundaries

- Applications may import workspace packages.
- Workspace packages must not import applications.
- Applications must not import each other.
- Add a shared package only when at least 2 real consumers justify it.
- Keep product logic out of operational health routes and infrastructure code.
- Keep visual implementation aligned with `DESIGN.md`.

## Development

- Use English in code, comments, tests, documentation, and commits.
- Use Conventional Commits.
- Use snake_case for PostgreSQL tables and columns.
- Validate user input and external data at system boundaries.
- Keep every code comment short and on one line.
- Do not add sample customer, employee, company, transaction, or analytics data.
- Do not commit environment files, credentials, keys, dumps, exports, or logs.
- Move unwanted repository files to `_junk/` instead of permanently deleting
  them.
- Add tests for non-trivial changes and run the fastest meaningful gate.

## Commands

- `pnpm dev`: run all applications in watch mode
- `pnpm check`: run formatting, linting, type checking, tests, and builds
- `pnpm test:watch`: run workspace tests in watch mode
- `POSTGRES_PASSWORD=local-validation-only pnpm compose:config`: validate local
  Compose
- `POSTGRES_PASSWORD=local-validation-only pnpm compose:config:production`:
  validate production Compose

Read `docs/README.md` before changing infrastructure or workspace boundaries.
