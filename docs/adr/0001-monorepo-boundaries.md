# ADR 0001: Monorepo Boundaries

- Status: accepted
- Date: 2026-08-28

## Context

BAP needs independently runnable web, application API, and reporting API
processes while sharing development policy and task orchestration.

## Decision

Use pnpm workspaces with applications under `apps/*`, reusable packages under
`packages/*`, and Turborepo for the task graph. Applications may depend on
packages. Packages cannot depend on applications, and applications cannot import
each other.

Only ESLint and TypeScript configuration packages exist initially because all 3
applications consume them. A generic shared or domain package requires at least
2 real consumers.

## Consequences

The dependency graph stays directional and deployable processes remain isolated.
Some small operational code is duplicated until a real shared abstraction is
justified.
