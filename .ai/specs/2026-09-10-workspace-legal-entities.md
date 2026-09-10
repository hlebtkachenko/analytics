# Workspace Legal Entities

**Date:** 2026-09-10

## Problem

The 2026-09-08 brainstorm asks for two-level tenancy: an organization is a
workspace, and many legal entities (companies and sole traders) live inside it
and can be opened separately or analysed together. Today the organization is
the only tenant unit, `member` can upload data and there is no way to restrict
an admin or member to a subset of entities. See ADR 0011.

## Scope

- Add `app.legal_entity` inside an organization, with kind `company` or
  `sole_trader` and an optional registration number.
- Attach every dataset and upload to exactly one legal entity.
- Make `member` read-only, keep `admin` able to create and edit entities and
  upload data, and keep entity deletion, organization settings, membership and
  entity access with `owner`.
- Add a per-member entity scope: `all` (default) or `restricted` to an explicit
  set of entity ids. Owners are never restricted.
- Add a per-page scope switch (all entities or one entity) to the datasets page.
- Not in scope: workspace deletion, custom roles, cross-workspace queries, a
  Carbon redesign of the temporary organization pages, per-dataset sharing.

## Design

Vocabulary: "organization" stays the workspace and slug owner; "legal entity"
is the inner object. Row level security keeps the organization as its only
boundary. Entity selection and the restricted scope are application-level
filters applied by the API from one resolver, exactly as the meeting asked.

Migration `20260910.0001_legal_entities.sql`:

- `app.legal_entity(id, organization_id, name, kind, registration_number,
  created_by, created_at, updated_at)`, unique `(id, organization_id)` and
  `(organization_id, name)`; kind check `company | sole_trader`.
- `app.member_entity_scope(organization_id, user_id, mode, updated_by,
  updated_at)`, primary key `(organization_id, user_id)`, mode check
  `all | restricted`.
- `app.legal_entity_access(organization_id, user_id, legal_entity_id,
  created_by, created_at)`, composite foreign key to the entity, cascade.
- `app.dataset.legal_entity_id` and `app.upload.legal_entity_id`, both
  `NOT NULL` with composite foreign keys `ON DELETE CASCADE`. A development
  database holding datasets must be reset before this migration.
- The tenant transaction gains `bap.role`. Helpers `app.role_can_write()`
  (`owner`, `admin`) and `app.role_is_owner()` gate every write policy. Reads
  stay organization-wide, so the creator and per-dataset grant conditions leave
  the `SELECT` policies and `app.data_grants` is dropped.
- Entity, scope and access tables are `ENABLE` and `FORCE` row level security:
  `SELECT` on organization match; entity `INSERT` and `UPDATE` need
  `role_can_write()`; entity `DELETE`, scope and access writes need
  `role_is_owner()`.
- `DATABASE_MIGRATION_COMPATIBILITY` becomes `20260910.0001`.

`@bap/db`: `TenantContext` gains `role`; `withTenantContext` sets all three
settings. New `readEntityScope(transaction, { organizationId, role, userId })`
returns `{ mode: 'all' }` for owners or unscoped members and
`{ mode: 'restricted', legalEntityIds }` otherwise.

`@bap/security`: capabilities become `manageOrganization`, `manageMembers`,
`manageEntityAccess`, `createEntities`, `updateEntities`, `deleteEntities`,
`uploadData`, `useAi`. Owner holds all; admin holds `createEntities`,
`updateEntities`, `uploadData`, `useAi`; member holds only `useAi`. The access
response gains `entityScope`. Shared schemas: `legalEntityKindSchema`,
`legalEntitySchema`, `entityScopeSchema`, `legalEntityIdentifierSchema`, and
`legalEntityInScope(scope, id)`.

`apps/api`, all under `/v1/organizations/:organizationId`, resource token plus
membership on every call, entity scope applied after membership:

- `GET /legal-entities` lists entities in scope, at most 200, newest first.
- `POST /legal-entities` `{ name, kind, registrationNumber? }` needs
  `createEntities`, returns 201.
- `PATCH /legal-entities/:legalEntityId` same body, optional fields, needs
  `updateEntities` and scope.
- `DELETE /legal-entities/:legalEntityId` needs `deleteEntities`, returns 204.
- `GET|PUT /members/:userId/entity-scope` needs `manageEntityAccess`; the body
  is the `entityScope` shape; an owner target is rejected with 409; unknown
  entity ids are rejected with 400.
- `GET /datasets?legalEntityId=` filters by scope and optional entity; each
  summary carries `legalEntityId`. Rows and export return 404 when the dataset's
  entity is out of scope.
- `POST /uploads` needs the multipart field `legalEntityId` in scope.
- Entity and scope writes call `app.record_audit`.

`apps/reporting-api` mirrors the access response including `entityScope`.

`apps/web`: the organization plugin gets explicit access control where only
`owner` may update the organization, manage members or invitations. The BFF
mirrors every new contract and forwards the new routes. `/[orgSlug]/entities`
lists, creates, edits and deletes entities by capability. `/[orgSlug]/members`
gains an owner-only entity scope editor. The datasets page gets an entity scope
switch (all entities or one) and an upload entity selector. `/access` shows the
new capabilities and the scope.

## Security

Entity ids are validated as UUIDs at the API and BFF boundaries. Names and
registration numbers are trimmed, bounded and never logged. Membership is
re-resolved on every request and on every dequeued job; the role travels only
inside the tenant transaction, never in a token. A restricted member sees an
out-of-scope dataset as not found.

## Verification

Unit tests for the contract, resolvers, controllers and pages; the PostgreSQL
integration suite proves role-gated writes, entity cascade, scope reads and the
dropped grant table; operational Playwright proof for owner, admin and member;
`pnpm check`, `pnpm test:integration`, Compose model verification.

## Open questions

Whether `member` should also lose `useAi` is left open; the assistant only reads
data the member can already view, so it stays available.
