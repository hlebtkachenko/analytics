# ADR 0011: Two-Level Tenancy

- Status: accepted
- Date: 2026-09-10

## Context

The 2026-09-08 product brainstorm redefined what an organization means in BAP.
It is a workspace, not a legal entity. A workspace owner connects many legal
entities, companies and sole traders, and every member analyses them together or
one at a time. Owners change workspace settings, admins change what lives inside
the entities, and members only read. Admins and members may be limited to a
subset of entities.

Until now the organization was the single tenant unit, the `member` role could
upload data, dataset visibility depended on the creator or a per-dataset grant,
and no inner object existed.

## Decision

The organization stays the workspace, the slug owner, and the only row level
security boundary. Every tenant transaction still binds one organization id and
now also binds the caller's role, so the database keeps refusing writes from a
read-only member and entity deletion from an admin.

Legal entities are rows in `app.legal_entity` inside an organization. Every
dataset and upload belongs to exactly one entity. Entity selection and the
restricted member scope are application-level filters computed by one resolver
in the API from `app.member_entity_scope` and `app.legal_entity_access`; the
database does not filter rows by entity. The "all entities" view is the absence
of that filter, never a cross-organization query.

Capabilities remain a UI hint derived from the role, and both APIs enforce them
before opening a tenant transaction. Per-dataset grants are removed.

## Consequences

The user, membership, invitation, slug, route and resource-token boundaries are
unchanged. Existing RLS proofs keep passing with the role setting added.

A restricted member sees an out-of-scope dataset as not found, the same answer a
stranger gets. Because entity filtering lives in the application, every new data
path must go through the shared scope resolver; the integration suite and the
operational proof exist to keep that promise visible.

Admins no longer manage members or organization settings; that moved to owners
with this decision and can be revisited without a schema change.
