# BAP Documentation

## Current status

The operational SaaS foundation, identity and organization milestones, and the
pinned Carbon workbench are delivered on `main`. Their final integration closure
keeps the organization quota, role isolation, slug boundary, and existing RLS
invariants under one repository gate. Analytics product behavior and production
rollout remain deliberately deferred until their requirements and owner-provided
infrastructure inputs exist.

## Documentation map

- [Getting started](getting-started.md)
- [Development workflow](development.md)
- [Feature spec convention](../.ai/specs/README.md)
- [Configuration](configuration.md)
- [Testing](testing.md)
- [Deployment](deployment.md)
- [Security](security.md)
- [Authentication and organization access](authentication.md)
- [Backup and restore proof](backup-and-restore.md)
- [Phase 5 SaaS foundation report](reports/phase-5-saas-foundation.md)
- [Phase 6 platform batteries report](reports/phase-6-platform-batteries.md)
- [Master plan execution report](reports/master-plan-execution.md)
- [Foundation research](foundation-research.md)
- [Carbon integration](design-system/carbon.md)
- [Carbon offline knowledge base](design-system/knowledge-base/README.md)
- [Carbon workbench plan and verification](planning/carbon-workbench.md)
- [Platform batteries plan](planning/platform-batteries.md)
- [Tenant data foundation plan](planning/tenant-data-foundation.md)
- [MCP server plan](planning/mcp-server.md)
- [Carbon patterns](design-system/patterns.md)
- [Carbon accessibility](design-system/accessibility.md)
- [Architecture](../ARCHITECTURE.md)
- [Design](../DESIGN.md)
- [Third-party notices](../THIRD_PARTY_NOTICES.md)
- [ADR 0001: monorepo boundaries](adr/0001-monorepo-boundaries.md)
- [ADR 0002: separate application and reporting APIs](adr/0002-separate-application-and-reporting-apis.md)
- [ADR 0003: Compose deployment model](adr/0003-compose-deployment-model.md)
- [ADR 0004: controlled internet egress](adr/0004-controlled-internet-egress.md)
- [ADR 0005: platform batteries](adr/0005-platform-batteries.md)
- [ADR 0006: upload staging](adr/0006-upload-staging.md)
- [ADR 0007: public sign-up](adr/0007-public-sign-up.md)
- [ADR 0008: operator-tier account erasure](adr/0008-account-erasure.md)
- [ADR 0009: organization creation foundation](adr/0009-organization-creation-foundation.md)
- [ADR 0010: organization route resolution](adr/0010-organization-route-resolution.md)

Documentation must stay synchronized with commands, runtime behavior, and
architecture decisions in the same change.
