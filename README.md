# Business Analytics Platform

BAP is a pnpm and Turborepo monorepo for a Next.js web application, an
application API, a reporting API, and PostgreSQL 18. The repository contains
only synthetic configuration and operational smoke surfaces. Product behavior is
intentionally developed separately.

## Workspaces

- `apps/web`: Next.js App Router web application
- `apps/api`: NestJS application API
- `apps/reporting-api`: NestJS reporting API
- `packages/design-system`: Carbon components, tokens, themes, charts, and fonts
- `packages/eslint-config`: shared flat ESLint configurations
- `packages/typescript-config`: shared strict TypeScript configurations

## Start locally

Use Node.js 24.20.0 and pnpm 11.24.0.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

The default ports are 3000 for the web app, 3001 for the application API, and
3002 for the reporting API. Start PostgreSQL separately when persistence work
begins:

```sh
cp config/compose.environment.example .env
docker compose -f compose.yaml -f compose.development.yaml up database
```

Run the complete local gate with `pnpm check`. See
[docs/README.md](docs/README.md) for setup, architecture, testing, deployment,
configuration, and security documentation.
