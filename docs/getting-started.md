# Getting Started

## Requirements

- Node.js 24.20.0
- pnpm 11.24.0 through Corepack
- Docker Engine with Compose v2

```sh
nvm install
nvm use
corepack enable
corepack prepare pnpm@11.24.0 --activate
pnpm install --frozen-lockfile
pnpm check
```

Run `pnpm dev` to start the web app and both APIs. Default local URLs are:

- Web: `http://localhost:3000`
- Application API health: `http://localhost:3001/health`
- Reporting API health: `http://localhost:3002/health`

The applications currently do not require PostgreSQL to boot. Start it when
working on persistence:

```sh
cp config/compose.environment.example .env
docker compose -f compose.yaml -f compose.development.yaml up database
```

All example values are synthetic and must be replaced outside source control for
any shared or production environment.
