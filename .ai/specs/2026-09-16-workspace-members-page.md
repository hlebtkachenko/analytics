# Members Page in Carbon

**Date:** 2026-09-16

## Problem

`/[orgSlug]/members` is still the throwaway milestone-2 page: plain HTML, inline
`<form>`s, a bare invitations list, radio-and-checkbox scope forms, one
`?result=` line. Membership, invitations and entity scope are real Better Auth
and BFF data (list, invite, role change, remove, cancel, resend, scope
read/write all exist), so this becomes a Carbon page like the entities page, no
backend work.

## Scope

- Replace `/[orgSlug]/members/page.tsx` with a Carbon page in `PageContainer`: a
  workspace-name heading and Carbon `Tabs` for the two views of the membership
  collection, "Members" and "Invitations", deep-linked by `?tab=invitations`.
- Members tab: a searchable `DataGrid`, an "Invite member" toolbar action, and
  gated row actions Change role (Modal, role `Select`, promotion to owner
  allowed), Edit entity scope (Modal, mode All/Restricted plus a
  `FilterableMultiSelect` of the legal entities), Remove (danger Modal).
- Invitations tab: a `DataGrid` filtered to `status === 'pending'` with an
  "Expired" label derived from `expiresAt < now`, row actions Cancel (danger
  Modal) and Resend, and the invite Modal (email, role) with inline errors for
  an invalid email and a duplicate pending invitation.
- Empty states as `PageContainer` blocks with the primary action when allowed;
  `InlineNotification` on a failed load; toasts. Drop the throwaway marker;
  correct counts (three temporary pages become two, `/[orgSlug]` landing and
  `/[orgSlug]/settings`, plus `/account`) and the route row.
- Out of scope: every other `[orgSlug]` page; batch actions; a last-active
  column; teams; any new API route, BFF route, contract mirror, migration, icon.

## Design

Files modified: `.../members/page.tsx` (server component that resolves the
tenant and server-reads capabilities, members, invitations, scopes and entities
via `readOrganizationAccess`, `auth.api.listMembers`/`listInvitations`,
`readMemberEntityScopes` and `readLegalEntities`, then renders `PageContainer` +
the client view), its `page.test.tsx`; `src/lib/auth/client.ts` (add
`organizationClient()`); `i18n/resources.ts`;
`components/icon-contract.test.tsx` (remove the members `throwawayPages` entry);
the throwaway count and route row in `DESIGN.md`, `ARCHITECTURE.md` and the
`docs/` set. Created: `.../members/members-view.tsx` (client child owning the
Tabs, grids, Modals, toasts).

Removed (the throwaway page was their only caller; whole files copied to
`_junk/` first because `_junk/` is gitignored, then `git rm`, the rest deleted
in place): `inviteOrganizationMemberAction`,
`updateOrganizationMemberRoleAction`, `removeOrganizationMemberAction` and the
`organizationRoleSchema`, `invitationInputSchema`, `memberRoleInputSchema`,
`memberRemovalInputSchema` they used from `actions.ts` (keep
create/accept/decline used by the workspace list); `ActionOrganization`,
`ScopedAction`, `runScopedAction` from `action-support.ts` (keep
`resolveActionOrganization`, used by `updateOrganizationAction`);
`writeMemberEntityScope` and the dead `readMemberEntityScope` from
`entities.ts`; the whole files `entity-actions.ts` and `entity-actions.test.ts`;
and the covering tests in `actions.test.ts` and `entities.test.ts`. No new
server action is added; the build-plan cancel/resend ones are not.

- Transport: all Better Auth member/invitation mutations go through client
  `authClient.organization.*` (`inviteMember` with optional `resend`,
  `updateMemberRole`, `removeMember`, `cancelInvitation`); each request except
  `cancelInvitation` carries an explicit `organizationId` the auth before-hook
  requires, and Better Auth re-derives membership and permission from the
  session, so the browser id never selects a tenant. Entity scope goes through
  `mutateJson` with method `PUT` to `memberEntityScopePath` (a client `fetch` to
  the BFF). Chosen because only a client call surfaces the Better Auth error
  code the invite modal needs for inline errors and every modal needs to stay
  open on failure, unlike the marker-collapsing server actions (as in unit F).
- i18n: one new `members` namespace, keys sorted, groups `tabs`, `list` (titles,
  columns, search, scopeAll/scopeCount, inviteAction, empty states, loadError),
  `roles`, `actions`, `invite` (labels, emailInvalid, alreadyInvited,
  alreadyMember), `role`, `scope`, `remove` (with the `lastOwner`/`unavailable`
  messages), `toast`.
- Both grids: `sortable`, `size="sm"`. Members `columns` (name, email; role and
  scope summary via `renderCell`), `initialSort` name, `search`,
  `toolbarActions` (invite, `manageMembers`), `rowActions` (Change role, Remove
  `isDelete` with `manageMembers`, Remove hidden on the caller's own row; Edit
  scope with `manageEntityAccess`, hidden on owner rows since the API answers
  409 for an owner target and an owner is always "All entities"). Invitations
  `columns` (email, role, expires; no raw status column), `initialSort` email,
  `rowActions` (Cancel `isDelete`, Resend), each `manageMembers`.
- Tabs deep link: the view reads `useSearchParams`, opens Invitations when
  `tab=invitations`, and `router.replace`s `?tab=` on change (members default).
- Scope modal: its entity list and scope map are the server reads passed in (no
  stored row means "All entities"); a null read withholds it, never
  unrestricted.
- Capabilities and validation: `readOrganizationAccess` yields
  `manageMembers`/`manageEntityAccess` booleans deciding which controls render,
  each re-checked by Better Auth per role statement (ADR 0011 grants both to the
  owner alone). The invite modal validates locally (`z.email().max(254)`, role
  enum) before calling; Better Auth and the BFF re-validate.
- Error mapping (all leave the modal open): invite
  `USER_IS_ALREADY_INVITED_TO_THIS_ORGANIZATION` -> `invite.alreadyInvited` and
  `USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION` -> `invite.alreadyMember`,
  both inline on the email field; an invalid email is caught client-side as
  `invite.emailInvalid`; `YOU_CANNOT_LEAVE_THE_ORGANIZATION_WITHOUT_AN_OWNER`
  (demotion) / `YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER` (remove) ->
  `role.lastOwner`/`remove.lastOwner` toast; any other non-ok -> generic toast.
  On success the view toasts, closes the modal and `router.refresh()`s.

## Security

Invitation ids and user ids never appear in a URL query or a log: the invitation
id travels only in the `cancelInvitation` body, the member id only in the
`updateMemberRole`/`removeMember` body, and the user id only inside the BFF path
segment on the scope GET/PUT (`memberEntityScopePath` encodes it), per the
entity-id rule in spec 2026-09-16. Page reads and mutations re-check the
session; Better Auth re-checks `manageMembers` per role statement and owns the
sole-owner guard; the BFF and `apps/api` re-check `manageEntityAccess` on the
scope write. No browser id selects a tenant:
`resolveOrganizationRouteForRequest` maps the slug server-side and each mutation
body only re-derives membership through Better Auth.

## Verification

`page.test.tsx` renders the view inside `I18nProvider` and `ToastProvider` with
`fetch`, `authClient.organization` and `next/navigation` stubbed, covering: both
tabs render rows; `?tab=invitations` deep link; invite success (toast, modal
closes, refresh); invite duplicate error (inline `alreadyInvited`, modal open,
no toast); role change; remove confirm; scope save (PUT sent); cancel and resend
(`resend: true`); capability-hidden actions (no controls without
`manageMembers`/`manageEntityAccess`); load error (`InlineNotification`). Gate
(fast only): `pnpm --filter @bap/web` `lint`, `typecheck`, `test`,
`format:check`. No migration, no `test:integration`.

## Open questions

Both settled (see Corrections):

1. Remove on the caller's own row: hidden. Leaving is the settings page flow
   (unit D), so the members page never removes the caller.
2. Expires column source: kept. `listInvitations` returns `expiresAt`.

## Corrections (2026-09-16, advisor-verified against code)

1. Security: the auth before-hook (`apps/web/src/lib/auth/server.ts:111-122`)
   requires an explicit `organizationId` in every Better Auth member/invitation
   call: `invite-member`, `remove-member`, `update-member-role` (body),
   `list-members`, `list-invitations` (query). `cancel-invitation` is exempt,
   its body is `{ invitationId }` only. Body field names: `memberIdOrEmail` for
   `remove-member`, `memberId` for `update-member-role`. The browser sends
   `organizationId`; Better Auth re-derives membership and permission from the
   session; the page never trusts a browser-supplied id for rendering.
2. Owner rows carry no "Edit entity scope" action: the API answers 409 for an
   owner target (`entity-scope.controller.ts:143-146`); the scope cell shows
   "All entities".
3. Invitations tab filters `listInvitations` to `status === 'pending'` and
   derives an "Expired" label from `expiresAt < now` (Resend refreshes it).
   There is no raw status column; the expires column stays (`expiresAt` is
   returned).
4. `mutateJson` (`src/lib/datasets/client.ts`) gains `PUT` in its method union;
   the entity scope save uses `mutateJson` `PUT` to `memberEntityScopePath`.
5. Deletions are plain (see the Removed section): whole files go through
   `_junk/` then `git rm`; the rest are deleted in place.
6. Docs: the "three temporary" page count becomes "two" in `DESIGN.md`,
   `ARCHITECTURE.md`, `docs/application-routes.md`, `docs/authentication.md`,
   `docs/security.md`, `docs/testing.md`; the `docs/authentication.md` paragraph
   about the server-action sole-owner safeguard and the 100-member reread and
   the `docs/security.md` server-action trust-boundary sentence for members are
   rewritten, because Better Auth 1.7.4 blocks sole-owner removal and
   self-demotion itself.
7. Open questions settled as above.
8. `icon-contract.test.tsx` drops the members page from `throwawayPages`.
