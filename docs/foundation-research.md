# Foundation Research

The phase 1 foundation was selected from current primary documentation and
package registry metadata on 2026-08-28. Product behavior and visual design were
outside the research scope.

## Compatibility baseline

| Foundation | Pinned version | Reason                                                  |
| ---------- | -------------: | ------------------------------------------------------- |
| Node.js    |        24.20.0 | Active LTS compatible with NestJS 12 tooling            |
| pnpm       |        11.24.0 | Workspace catalogs and strict dependency controls       |
| TypeScript |          6.0.3 | Requested major and supported by typescript-eslint 8.68 |
| Turborepo  |        2.10.12 | Cached workspace task graph                             |
| Next.js    |         16.3.3 | Current App Router release                              |
| React      |         19.2.8 | Current Next-compatible React release                   |
| NestJS     |         12.0.1 | Current ESM-ready framework release                     |
| PostgreSQL |           18.6 | Current PostgreSQL 18 security release                  |
| Vitest     |         4.1.11 | NestJS 12 ESM and web unit test runner                  |
| ESLint     |         9.39.5 | Temporary EOL pin required by Next.js plugin peers      |
| Prettier   |          3.9.6 | Deterministic repository formatting                     |

TypeScript 7 is not used because the requested baseline is TypeScript 6 and the
pinned typescript-eslint release supports TypeScript versions below 6.1. ESLint
9 reached end of support on 2026-08-06, but the React, import, and accessibility
plugins required by stable Next.js 16.3.3 do not yet accept ESLint 10. Strict
peer validation remains enabled instead of suppressing that incompatibility.
Recheck the pin whenever Next.js updates its official plugin set. No ORM,
database driver, auth library, cache, queue, telemetry vendor, or domain package
was selected without real requirements.

## Primary references

- [pnpm workspaces](https://pnpm.io/workspaces)
- [pnpm catalogs](https://pnpm.io/catalogs)
- [pnpm settings](https://pnpm.io/settings)
- [Turborepo task configuration](https://turborepo.com/docs/crafting-your-repository/configuring-tasks)
- [Next.js installation](https://nextjs.org/docs/app/getting-started/installation)
- [Next.js standalone output](https://nextjs.org/docs/app/api-reference/config/next-config-js/output)
- [Next.js self-hosting](https://nextjs.org/docs/app/guides/self-hosting)
- [NestJS 12 migration guide](https://docs.nestjs.com/migration-guide)
- [NestJS testing](https://docs.nestjs.com/fundamentals/testing)
- [TypeScript 6.0 release notes](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html)
- [PostgreSQL Docker Official Image](https://hub.docker.com/_/postgres)
- [Docker Compose production guidance](https://docs.docker.com/compose/how-tos/production/)

The PostgreSQL 18 image changed its declared data volume to
`/var/lib/postgresql`. The Compose model uses that path instead of the version
17 and earlier `/var/lib/postgresql/data` path.
