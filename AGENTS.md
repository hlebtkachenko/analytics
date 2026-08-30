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
- Carbon facade in `packages/design-system` and its Storybook workbench in
  `apps/design-system-workbench`
- PostgreSQL 18
- Better Auth for browser identity and organization membership
- Caddy for public ingress and restic for one-shot backup operations
- Docker Compose for local and production-parity execution

## Boundaries

- Applications may import workspace packages.
- Workspace packages must not import applications.
- Applications must not import each other.
- Database access must go through `@bap/db`.
- Service JWT and access contracts must go through `@bap/security`.
- Application UI must import Carbon through `@bap/design-system`.
- The design-system workbench must consume only public design-system
  entrypoints.
- Browser sessions and resource JWTs must never cross their documented boundary.
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
- `pnpm design-system:dev`: run the local Carbon workbench
- `pnpm design-system:build`: build the static Carbon workbench
- `pnpm design-system:catalog`: refresh generated Carbon and workbench artifacts
- `pnpm design-system:browser:install`: install its local Chromium runtime
- `pnpm design-system:catalog:check`: verify pinned Carbon coverage artifacts
- `pnpm design-system:offline:check`: verify the static workbench without
  network access
- `pnpm design-system:test`: run design-system and workbench unit tests
- `pnpm design-system:test:browser`: run workbench browser and accessibility
  checks
- `pnpm check`: run formatting, linting, type checking, tests, and builds
- `pnpm test:watch`: run workspace tests in watch mode
- `pnpm test:coverage`: run workspace unit tests with coverage reporting
- `pnpm test:integration`: verify PostgreSQL roles, migrations, RLS, and the
  worker queue boundary
- `pnpm secrets:local`: create disposable ignored local credential files
- `pnpm compose:config`: validate development Compose without starting anything
- `pnpm compose:verify`: verify development, production, and operations topology
- `pnpm compose:config:production`: validate production Compose with synthetic
  non-routable host values

`pnpm check` chains `check:node-pins`, `format:check`, `lint`, `typecheck`,
`test`, and `build`, and stops at the first failure. Run one of them alone while
iterating, then run the whole gate before pushing.

- `pnpm check:node-pins`: verify every Node version pin agrees
- `pnpm format`: rewrite the repository with Prettier
- `pnpm format:check`: report Prettier differences without writing
- `pnpm lint`: run ESLint in every workspace
- `pnpm typecheck`: run TypeScript in every workspace
- `pnpm test`: run workspace unit tests once
- `pnpm build`: build every application and package

Read `docs/README.md` before changing infrastructure or workspace boundaries.
