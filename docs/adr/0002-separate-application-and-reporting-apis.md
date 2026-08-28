# ADR 0002: Separate Application and Reporting APIs

- Status: accepted
- Date: 2026-08-28

## Context

Application requests and reporting workloads can have different scaling,
latency, resource, and deployment characteristics.

## Decision

Create separate NestJS processes at `apps/api` and `apps/reporting-api`. Each
owns its bootstrap, configuration validation, health endpoint, tests, build
artifact, container image, and port.

## Consequences

The runtimes can evolve and deploy independently. Shared domain contracts are
not invented before endpoints and ownership requirements exist.
