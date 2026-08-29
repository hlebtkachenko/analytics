# Development Workflow

## Workspace commands

Turborepo runs build, type-check, lint, and test tasks across workspaces. pnpm
catalogs keep shared external dependency versions synchronized, and
`workspace:*` prevents internal packages from resolving from a registry.

```sh
pnpm dev
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

`pnpm check` is the complete local gate. A second unchanged build should use
Turborepo cache entries.

## Carbon workbench

Use the local Storybook workbench to inspect the complete pinned Carbon Core
surface and its offline handbook:

```sh
pnpm design-system:dev
pnpm design-system:catalog:check
pnpm design-system:build
```

Install the pinned local Chromium runtime once before running browser and
accessibility checks:

```sh
pnpm design-system:browser:install
pnpm design-system:test:browser
pnpm design-system:offline:check
```

The generated catalog, component entries, and source mappings must be refreshed
in the same change as a Carbon dependency upgrade.

## Local runtimes

`pnpm dev` runs workspace development commands. It is suitable for UI and
isolated package work. Authentication, BFF access checks, readiness, and the
Nest APIs require the configured PostgreSQL roles and secret files, so use the
Compose stack for integrated work:

```sh
pnpm secrets:local
docker compose -f compose.yaml -f compose.development.yaml up --build --detach --wait
```

Use `docker compose ... logs --no-color` for stack diagnostics and
`docker compose ... down` for normal shutdown. Do not use `down --volumes`
outside disposable local or CI environments.

## Port overrides

Set `WEB_PORT` and `POSTGRES_PORT` for the development Compose overlay. The
defaults are 3000 and 5432. The APIs are internal Compose services and are not
published by the development overlay. `PORT`, `HOST`, and `HOSTNAME` are
container runtime settings, not public browser configuration.

## Adding code

- Put browser and server-rendered UI in `apps/web`.
- Put application-facing endpoints in `apps/api`.
- Put reporting workloads in `apps/reporting-api`.
- Add a package only after at least 2 real consumers need one boundary.
- Add a new catalog entry for a dependency used by multiple workspaces.
- Keep workspace imports directed from applications to packages.
- Keep resource JWTs in server-only BFF calls. They must never cross the browser
  boundary.

Do not add fake domain models or sample business records to demonstrate a
framework. Tests must use minimal synthetic values tied to the behavior under
test.
