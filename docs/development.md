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
test -e .env || cp config/compose.environment.example .env
pnpm secrets:local
BAP_PUBLIC_HOST=http://localhost docker compose --env-file .env -f compose.yaml -f compose.development.yaml -f compose.mailpit.yaml up --build --detach --wait
```

Use `docker compose ... logs --no-color` for stack diagnostics and
`docker compose ... down` for normal shutdown. Do not use `down --volumes`
outside disposable local or CI environments.

Owner bootstrap and synthetic operational setup run only through the profiled
`bootstrap-owner` one-shot. That service holds separate auth and migrator
credential paths so each command can validate its slug, create or reuse the
user, establish the minimum initial quota, close the migrator pool, and then
create the organization. Do not execute `create-synthetic-account` inside the
long-lived web container: web intentionally has no migrator credential. The
synthetic command remains gated by `BAP_E2E_SETUP=true` and is not a general
quota administration tool.

Use the existing migrator one-shot for an explicit organization quota change:

```sh
docker compose -f compose.yaml -f compose.development.yaml run --rm --no-deps migrator node node_modules/@bap/db/dist/cli.js organization-quota --email member@example.test --total 2 --note 'operator-approved capacity'
```

All 3 named arguments are required. The command writes only through a local
owner role inside its transaction and emits the resulting row as JSON. Do not
run it in web or add the migrator credential to a long-lived service.

## Two-level tenancy demo

One command builds a disposable stack, creates an owner, an admin, and a member
of the same organization with one generated local password, and runs the legal
entity browser proof with a narrated reporter:

```sh
pnpm demo:tenancy
pnpm demo:tenancy:down
```

It uses the same Compose files and ports as the operational proof workflow (web
39100, PostgreSQL 39432, Mailpit 39825), resets any previous demo stack first,
and leaves the stack running so the three roles can be explored by hand. The
printed password is disposable and local only.

## Conductor workspaces

Each Conductor workspace is a separate git worktree, so everything the
repository ignores starts missing: `node_modules`, build output, and the
`.secrets` directory the Compose stack mounts all eleven of its secrets from.
`.conductor/settings.toml` therefore runs `scripts/conductor-setup.sh` on
creation, which attempts the pinned nvm install, asserts the running Node
version exactly against `.nvmrc`, installs with a frozen lockfile, and seeds the
local secrets. Run that script by hand after a plain `git clone` to reach the
same state.

Conductor run scripts are nonconcurrent across this repository. The native
development command includes the workbench's fixed port, and the integrated
stack creates Docker resources outside the worktree. Use one workspace run
script at a time; direct terminal commands remain available when deliberate
parallel isolation has been arranged manually.

Archiving a workspace deletes its directory and nothing outside it, so
`scripts/conductor-archive.sh` runs first and removes the Compose project the
`stack` run script created. It is the one sanctioned use of `down --volumes`,
because the workspace those volumes belong to is being destroyed in the same
step. It names both the bootstrap and operations profiles, because `down`
removes only the volumes its configuration declares. A missing Docker binary, a
stopped daemon, and an unknown workspace identifier each report and exit
successfully, so archiving is never blocked.

The workbench Chromium runtime is deliberately not part of setup. Its cache is
machine-global, so downloading it per workspace would spend network on something
most workspaces never use. Use the `browser-install` run script, or
`pnpm design-system:browser:install`, when a workspace needs it.

Conductor reads `.conductor/settings.toml` from the repository default branch,
so a change to these scripts affects new workspaces only after it merges.

## Port overrides

Set `WEB_PORT` and `POSTGRES_PORT` for `compose.development.yaml`, then select
`compose.mailpit.yaml` and set `MAILPIT_HTTP_PORT` when synthetic mail
inspection is needed. The defaults are 3000, 5432, and 8025, and every published
host port must be unique. Mailpit SMTP remains internal to Docker. Its loopback
companion accepts only GET `/readyz` and GET `/api/v1/search`; the UI, every
other path, and non-GET methods return 404. The application APIs remain internal
Compose services. `PORT`, `HOST`, and `HOSTNAME` are container runtime settings,
not public browser configuration.

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
