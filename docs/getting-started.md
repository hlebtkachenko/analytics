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

`engineStrict` is enabled, so `pnpm install` fails with
`ERR_PNPM_UNSUPPORTED_ENGINE` when the active Node.js version is not 24.20.0.
Run `nvm use` in the shell, or restart the editor or terminal application when
it still carries an older Node.js path from a previous session.

Install the workbench browser once when you need its Storybook browser,
accessibility, or offline-static checks:

```sh
pnpm design-system:browser:install
```

```sh
cp config/compose.environment.example .env
pnpm secrets:local
BAP_PUBLIC_HOST=http://localhost docker compose --env-file .env -f compose.yaml -f compose.development.yaml up --build --detach --wait
```

`pnpm check` is the repository quality gate. The public local endpoint is
`http://localhost:3000/health`. Caddy is the only published application service.
PostgreSQL is published only to loopback for local diagnostics.

The committed template uses production-shaped public values. The inline local
host override above is required unless you set
`BAP_PUBLIC_HOST=http://localhost` in the ignored `.env` file.

Create the first owner once, from an interactive terminal, after the stack is
healthy:

```sh
docker compose --env-file .env --profile bootstrap -f compose.yaml -f compose.development.yaml run --rm bootstrap-owner
```

The command asks for an owner email, display name, organization name, and a
hidden 14-128 character password. Do not use it in automation. All example
values are synthetic, and shared or production environments require
owner-provided secret files and origins.
