# Business Analytics Platform

BAP is a pnpm and Turborepo monorepo for a Next.js web application, an
application API, a reporting API, and PostgreSQL 18. The repository contains
only synthetic test data and operational foundation code. Product behavior is
intentionally developed separately.

## Workspaces

- `apps/web`: Next.js App Router web application
- `apps/api`: NestJS application API
- `apps/reporting-api`: NestJS reporting API
- `packages/design-system`: Carbon components, tokens, themes, charts, and fonts
- `packages/db`: reviewed migrations, PostgreSQL roles, pools, and tenant
  context
- `packages/security`: resource JWT, access-contract, and limiter primitives
- `packages/eslint-config`: shared flat ESLint configurations
- `packages/typescript-config`: shared strict TypeScript configurations

## Install

Use Node.js 24.20.0 and pnpm 11.24.0.

```sh
corepack enable
pnpm install --frozen-lockfile
```

## Start the complete local stack

```sh
pnpm secrets:local
docker compose -f compose.yaml -f compose.development.yaml up --build --wait
```

Open <http://localhost:3000>. Caddy is the browser entrypoint. PostgreSQL is
available on loopback for migration and inspection tools; the two Nest services
remain private. Use `pnpm dev` for native application watch mode after the
database roles and migrations exist.

Run `pnpm check`, `pnpm test:integration`, and `pnpm compose:verify` before
shipping foundation changes. See [docs/README.md](docs/README.md) for setup,
architecture, testing, deployment, configuration, and security documentation.
