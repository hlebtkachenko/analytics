# Identity and Organizations Execution Report

Pull requests 18 to 29 delivered Milestone 1 Identity and Milestone 2
Organizations. A following unmerged batch added the authenticated application
shell, real Access destinations, invitation-only sign-up visibility, and a
Conductor/CI hardening pass. This report records the decisions and residual gaps
that the code alone does not explain.

## What shipped

Milestone 1 Identity (phases 1-6, PRs 18-22): email/password authentication,
email verification, password reset, TOTP two-factor, the account lifecycle form
with hard-delete erasure, and Better Auth admin-endpoint gating. Public sign-up
is off by default; the only bypass is a pending, unexpired invitation matched
against both the edge handler and the Better Auth before-hook. PR 23 proved the
complete signed-up-to-verified lifecycle operationally against a disposable
Mailpit sink. PR 28 added the curated 18-icon `@bap/design-system/icons` facade
so application code stops importing `@carbon/icons-react` directly.

Milestone 2 Organizations (phases 7-11, PRs 24-27, 29): a durable creator quota
enforced by a transaction-advisory-locked database trigger, the reserved
top-level slug contract, the gated organization creation path and its
migrator-CLI quota command, slug-based membership-gated routing for
`/[orgSlug]`, `/[orgSlug]/members`, and `/[orgSlug]/settings`, and 5
deliberately temporary plain-HTML organization pages. PR 29 consolidated the
integration invariants (roles, migrations, RLS, worker queue boundary) into one
gate.

This batch (unmerged) added the shared Carbon application shell (skip link,
Access/Organizations/Datasets/Account navigation, active-route state), plain
native breadcrumbs on organization descendant pages and a Carbon breadcrumb on
the inline dataset detail, real member-management and upload links plus
non-interactive "Unavailable" tiles for grant management and the general
assistant on `/access`, visible invitation-only sign-up copy while the public
switch stays off, a generic side-effect-free signed-out
`/invitation/[invitationId]` route, a fix for the Carbon closed `SideNav`
overlay intercepting page controls, Conductor nonconcurrent run scripts, and CI
shellcheck plus path-filter tightening for the operational-proof workflow.

## Current behavior

**Identity.** `/sign-in`, `/sign-up`, `/forgot-password`, `/reset-password`,
`/activate`, and `/welcome` are Carbon identity pages outside the application
shell. `/sign-up` always renders its form; public-registration copy shows only
while the database switch is on, invitation-only copy shows otherwise, and the
submitted email must still satisfy the same server-side invitation predicate
either way. The sign-in create-account link is shown only while the switch is
on.

**Organizations.** `/organizations`, `/organizations/new`, `/[orgSlug]`,
`/[orgSlug]/members`, and `/[orgSlug]/settings` remain deliberately temporary
plain semantic HTML with no CSS, `@bap/design-system`, or icon imports, per
explicit product decision; their slug resolution, membership gate, and server
actions are the durable boundary.

**Navigation shell.** A client shell wraps only recognized signed-in application
routes (Access, Organizations, Datasets, Account, and their members/settings
descendants) with a skip link, header navigation, and a mobile `SideNav`. It is
not rendered around identity, invitation, and design-system reference routes.
See [the application route map](../application-routes.md) for the full contract.

**Access.** `/access` resolves independent application and reporting access
contracts per organization. Member management links to `/{slug}/members` and
upload links to the selected `/datasets` state; both are validated against the
authenticated organization list before use. Grant management and the general
assistant render as descriptive, non-interactive "Unavailable" tiles rather than
inert controls.

**Icons.** Application code imports only the curated 18-export
`@bap/design-system/icons` facade. The generated catalog still retains the full
upstream inventory for the workbench and for upgrade inspection.

## Verification performed

- Unit tests cover shell route inclusion/exclusion, the single skip target,
  active-navigation state, breadcrumbs, Access destination and unavailable-tile
  rendering, authorized query-slug selection, sign-up discoverability, and
  invitation-page signed-out guidance.
- `pnpm test:integration` verifies PostgreSQL roles, migrations, RLS, and the
  worker queue boundary in one consolidated gate.
- A fresh isolated one-worker operational run passed in 47.7 seconds:
  navigation, public-signup-OFF invited registration, verification, UI sign-in,
  invitation acceptance, intended role assignment, role update, removal,
  sign-out, post-revocation 401, and zero browser console errors. Public signup
  ended off and every isolated stack, port, and container was torn down
  afterward.
- Accessibility: keyboard focus order, axe, and 320px/640px reflow checks run in
  the operational suite. A manual headed-Chrome check confirmed true 200%
  browser zoom (640 CSS-pixel viewport at DPR 4) with no horizontal overflow and
  preserved keyboard focus.
- A current-tree security review passed independently for this batch.

## Residual gaps

- The 5 organization pages and the account page are intentionally temporary
  plain HTML by product decision; permanent Carbon screens remain future work.
- There is no BAP admin UI or BAP HTTP consumer for any of Better Auth's 15
  installed Admin-plugin endpoints.
- Better Auth 1.7.2's last-owner protections are not globally race-safe: its
  role check only guards self-demotion and its removal check is bounded by the
  configured member-list limit. The temporary organization UI rereads membership
  before mutating and refuses a final-owner change locally, but that
  read-then-mutate is not atomic. A global, race-safe solution remains follow-up
  work.
- VoiceOver verification was attempted on 2026-09-01 but did not complete: macOS
  denied both the accessibility-window attachment and Apple Events UI control
  needed for the check. A human VoiceOver confirmation is still required and is
  not claimed here.
