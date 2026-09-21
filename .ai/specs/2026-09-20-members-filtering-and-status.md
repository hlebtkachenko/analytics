# Members table: Carbon parity, batch filtering, and member status

**Date:** 2026-09-20

## Problem

The members table drifts from Carbon's data-table and filtering guidance: the
toolbar uses text-link actions and floats off the page grid, row density lives
in a table menu (belongs in app preferences), the expanded row duplicates line
data, there is no pagination, and there is no member status. The product owner
wants Carbon's "multiple filters with batch updates" pattern for Role, Entity,
and Status, and a real active/inactive member status that never loses "who did
what" when a member leaves.

## Scope

### A. Table Carbon parity (frontend only)

- Toolbar is a single Carbon toolbar row: open search on the left that stretches
  to meet the right-aligned actions; a batch Filter control; a Download button;
  and the primary Invite member button as the solid block at the far right.
- Remove the Refresh button and the row-height (density) menu. Density is an
  app-wide preference set on a future preferences page, not a per-table control.
- Columns in the row: Name, Email, Role, Entity scope, Status, Joined.
- Expanded row shows no data already in the row. Supplementary only: full
  role-permission text, full entity-access list, and status/last-change context.
- Pagination: Carbon `Pagination` at the bottom, default 10 rows per page.
- The table aligns to the page's Carbon 2x grid; no full-bleed float.

### B. Batch filtering (frontend only)

Carbon "multiple filters with batch updates"
(https://carbondesignsystem.com/patterns/filtering/). A Filter affordance opens
a container with three categories:

- Role: owner, admin, member (multiselect).
- Entity: the organization's legal entities (multiselect), only when the scope
  editor is available.
- Status: Active, Inactive (multiselect).

Selections apply together on an "Apply filters" action; the data refreshes once.
The closed Filter control shows the applied-filter count and allows clearing all
filters without reopening. Each category can clear itself; a global clear resets
every category. Default start state: Status = Active selected, Role and Entity
unselected (all). Title reflects the active status filter ("Active members (N)",
"Inactive members (N)", or "Members (N)").

### C. Member status and audit (full stack, per critical advisor)

Storage

- Add
  `status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive'))`
  to the Better-Auth-owned `auth.member` table. Declare it to Better Auth as
  `member.additionalFields.status` (`fieldName: 'status'`, `type: 'string'`,
  `input: false`, `defaultValue: 'active'`). Mirror in
  `packages/db/src/schema.ts` and `apps/web/src/lib/auth/models.ts`.
- No app-side status table. Every access resolver already reads `auth.member`.

Semantics

- Active: full access per role and entity scope.
- Inactive: zero access everywhere (API, worker, product shell, switcher, Better
  Auth org endpoints). Row retained with name, email, role, joined, entity
  scope. Owner may Reactivate; nobody reactivates self.
- "Remove" becomes "Deactivate"; no product path hard-deletes a membership.
  Settings "Leave workspace" becomes self-deactivate.
  `/organization/remove-member` and `/organization/leave` are disabled.

Write path (status and audit must be atomic; `bap_auth` cannot call
`app.record_audit`, so this cannot go through Better Auth)

- New `SECURITY DEFINER` function
  `auth.set_member_status(subject_user_id text, new_status text) RETURNS text`,
  owner `bap_owner`, `SET search_path = pg_catalog, auth`,
  `REVOKE ALL FROM PUBLIC`, `GRANT EXECUTE TO bap_api`. Org and actor from
  `current_setting('bap.organization_id'|'bap.user_id'|'bap.role')`, never
  arguments. Rules: fail on empty org/actor context; status in
  ('active','inactive'); subject != actor requires role owner; subject == actor
  allows only 'inactive'; `pg_advisory_xact_lock(hashtext(org_id))` then refuse
  to deactivate the last active owner (role test
  `'owner' = any(string_to_array( role, ','))`); missing row in this org means
  not found.
- New API endpoint `PUT /organizations/:organizationId/members/:userId/status`
  body `{ status }`, owner-or-self guard, one `runInTenantContext` transaction:
  `select auth.set_member_status($1,$2)` then
  `select app.record_audit( 'member.deactivated'|'member.reactivated', 'member', $1, $2::jsonb)`
  with metadata `{ previous_status, role }` and nothing else. Shape it like
  `writeMemberEntityScope` in
  `apps/api/src/legal-entities/legal-entity-repository.ts`.
- Web: `memberStatusPath` beside `memberEntityScopePath`; `mutateJson` PUT like
  `submitScope`. Replace the `authClient.organization.removeMember` call.

Audit

- Only `member.deactivated` / `member.reactivated`, metadata
  `{ previous_status, role }`. Never name or email (account erasure rewrites
  `user_id` and `resource_id` but not `metadata`, so PII in metadata would
  survive erasure).
- Extend `app.erase_user` to tombstone `audit_log.resource_id` for
  `resource_type = 'member'`, and widen the eraser column grant from `(user_id)`
  to `(user_id, resource_id)`.

Safeguards (all required; each is a workspace-lockout or access hole otherwise)

- `auth.resolve_membership` gets `AND m.status = 'active'`; the membership reads
  in `packages/db/src/access.ts` (product route, switcher, and
  `countSoleOwnedOrganizations`) get `status = 'active'` predicates.
- Before-hook in `apps/web/src/lib/auth/server.ts` rejects an inactive caller on
  every `organizationIdRequiredPaths` path (resolve the session with
  `getSessionFromCtx`).
- `beforeUpdateMemberRole` guard: refuse to demote the last active owner.
- Add `/organization/remove-member` and `/organization/leave` to
  `disabledAuthPaths`; remove them from `organizationIdRequiredPaths`.
- Re-invite of an inactive person returns
  `USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION`; the UI maps it to "already a
  member, inactive: reactivate instead".

Migration

- One forward-only additive migration
  `packages/db/drizzle/20260920.0001_member_status.sql`: ADD COLUMN status (fast
  default, no rewrite) + CHECK; `CREATE OR REPLACE` `resolve_membership` with
  the status predicate then re-state OWNER/REVOKE/GRANT; add
  `set_member_status`; the `erase_user` tombstone and grant change. Never drop,
  rename, or retype an existing `auth.member` column; never add RLS to any
  `auth` table; never grant `bap_api` DML on `auth.member`; never write
  `audit_log` from a trigger or `bap_auth`; never widen `record_audit`'s writer
  set; never put name or email in audit metadata; never delete member rows from
  product code.

Out of scope: role-change and member-add audit (follow-up, same definer
pattern), a member activity view (needs a separate activity contract), the app
preferences page for density.

## Verification

- DB integration tests (`packages/db/src/postgres.integration.test.ts`):
  `resolve_membership` excludes inactive; `set_member_status` refuses without
  context, refuses a non-owner acting on another, cannot see another org's row,
  refuses the last active owner, permits self-deactivate only, is not executable
  by `bap_reporting`; an audit row exists after the API write; `erase_user`
  tombstones the member `resource_id`.
- API tests for the status endpoint (owner-or-self guard, audit write).
- Web tests: `page.test.tsx` (status filter, Deactivate/Reactivate replaces
  Remove, status column), i18n keys, icon contract if toolbar icons change.
- Operational proof updated for the Deactivate menu item, dialog, and toast.
- Run the web fast gate and the DB/API integration gate.
