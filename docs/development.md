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

## Port overrides

Set `WEB_PORT`, `API_PORT`, and `REPORTING_API_PORT` when the defaults conflict.
The Conductor run command maps these to its allocated workspace port and the
next 2 ports, so parallel workspaces do not collide.

## Adding code

- Put browser and server-rendered UI in `apps/web`.
- Put application-facing endpoints in `apps/api`.
- Put reporting workloads in `apps/reporting-api`.
- Add a package only after at least 2 real consumers need one boundary.
- Add a new catalog entry for a dependency used by multiple workspaces.
- Keep workspace imports directed from applications to packages.

Do not add fake domain models or sample business records to demonstrate a
framework. Tests must use minimal synthetic values tied to the behavior under
test.
