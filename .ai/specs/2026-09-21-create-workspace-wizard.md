# Create workspace wizard

## Problem

`/workspaces/new` is a single blank form: it creates an empty workspace and
drops the owner on the workspace landing page with nothing in it. The owner then
has to discover the entities page and the members page on their own to add the
first legal entity and invite anyone. New owners arrive at an empty product with
no guided first step.

## Scope

Replace the single-step form with a three-step wizard on the same route:

1. Workspace (required): name and slug, creates the organization.
2. Legal entity (skippable): add the first legal entity, or skip.
3. Invite team (skippable): add zero or more invitations, or skip.

Uses the create-early flow: step 1 creates the real organization, steps 2 and 3
commit against the real organization id. Each step is independent; there is no
end-of-wizard orchestration and no rollback. Once the organization exists it
stays, whatever the owner does in steps 2 and 3.

Does not:

- Add any "connections" or integrations step.
- Add or invent sample data.
- Change the tenancy paths: organization create still goes through Better Auth
  `createOrganization`, entity create through the BFF, invites through
  `inviteMemberWithScopeAction`.
- Touch the entities page, the members page, or their contracts.
- Add a facade icon; the wizard uses text buttons to avoid churning the pinned
  icon contract.

## Design

- New server action `createWorkspaceAction({ name, slug })` in
  `apps/web/src/lib/organizations/actions.ts`. Same guards, quota check and slug
  validation as the old `createOrganizationAction`, but it returns a result
  instead of redirecting:
  `Promise<{ ok: true; id: string; slug: string } | { ok: false; reason: 'slug-taken' | 'quota-exhausted' | 'invalid' | 'error' }>`.
  The created organization id and slug come from the
  `auth.api.createOrganization` result; `revalidatePath('/workspaces')` on
  success. Input is validated with the existing `organizationSlugSchema` at the
  boundary.
- `createOrganizationAction` and `WorkspaceForm` become fully unused (only that
  form and its tests referenced them). Both are removed with their tests.
- New client component `create-workspace-wizard.tsx` under
  `apps/web/src/app/(product)/workspaces/new/`. It owns the three-step state,
  the Carbon `ProgressIndicator`/`ProgressStep` header, and the per-step forms.
  - Step 1 recomputes the slug from the name and validates with
    `organizationSlugSchema`, exactly like the old form, and calls
    `createWorkspaceAction`. On success it stores `orgId` and `slug`, locks step
    1 (fields disabled, shown complete) so the organization cannot be recreated,
    and advances. On failure it shows the matching inline message and stays.
  - Step 2 posts to `mutateJson(legalEntitiesPath(orgId), { method: 'POST' })`
    with the same body and 409/400 error surface as the entities page. Success
    stores the created entity id and name and advances; Skip advances without
    creating.
  - Step 3 adds invite rows, each calling `inviteMemberWithScopeAction`. Scope
    offers `all` vs `restricted` (the created entity) only when an entity was
    created in step 2; with no entity, scope is forced to `all` because a
    restricted scope needs at least one entity. Finish and Skip both
    `router.push('/{slug}')`.
- `page.tsx` keeps its auth and quota guards and the quota-exhausted warning,
  and renders the wizard instead of `WorkspaceForm`, passing `initialName`.
- i18n: extend `workspaces.create.*` with step titles, entity-step and
  invite-step labels, navigation labels and per-step messages; drop the keys
  only the removed form used (`submit`).

## Security

The wizard moves a workspace name and slug, a legal entity name and optional
registration number, and invite email addresses with a role and entity scope.
Every write crosses an already-enforced boundary: Better Auth makes the caller
the owner and enforces the invite permission; the BFF mints a per-call resource
token and validates the entity body; `inviteMemberWithScopeAction` enforces the
scope and refuses a restricted scope with no entity. No raw SQL, no new RLS
surface. Nothing new is logged; the action returns coarse reason codes, never
the upstream error body.

## Verification

- `apps/web/src/lib/organizations/actions.test.ts`: `createWorkspaceAction`
  returns the created id and slug, marks a taken slug, an exhausted quota, an
  unverified session and an invalid slug, and never redirects.
- `apps/web/src/app/(product)/workspaces/new/create-workspace-wizard.test.tsx`:
  step navigation, step 1 locking after create, skipping steps 2 and 3, and the
  forced `all` scope when no entity exists.
- `apps/web/src/app/(product)/workspaces/new/page.test.tsx`: updated for the
  wizard (quota gating still replaces the wizard at zero quota).
- Gate:
  `pnpm --filter @bap/web typecheck && pnpm --filter @bap/web lint && pnpm --filter @bap/web test`.

## Open questions

None.
