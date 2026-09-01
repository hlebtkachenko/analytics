# Organization throwaway UI

**Date:** 2026-08-31

## Problem

Organization creation, membership, invitations, and settings have server-side
contracts but no browser pages with which to exercise the complete member flow.

## Scope

Add the five Phase 10 pages: `/organizations`, `/organizations/new`,
`/{orgSlug}`, `/{orgSlug}/members`, and `/{orgSlug}/settings`. They are
deliberately temporary, plain semantic HTML with progressive-enhancement server
actions, no CSS, and no design-system imports. Every page carries the approved
delete-me comment. The landing page lists the signed-in member's organizations;
the creation page shows remaining attributed quota and hides its complete form
at zero; organization pages expose navigation, member and pending-invitation
management, and name/slug settings.

This phase adds no durable product shell, organization deletion, active-
organization selector, custom roles, teams, invitation acceptance changes, Phase
11 integration consolidation, or API/reporting slug support.

## Design

Server Components read the current verified session and call installed Better
Auth 1.7.2 server APIs with request headers. Every organization-scoped API call
binds the immutable id produced by the Phase 9 member-gated slug resolver; no
action accepts an organization id or redirect target from form data. Server
actions validate `FormData` with Zod, pass explicit organization ids, set
`keepCurrentActiveOrganization` during creation, revalidate affected routes, and
return or render only generic failures. Every scoped action validates its bound
slug before constructing a path or invoking the resolver or provider. Invalid
scope always returns the fixed `/organizations?result=error` redirect; valid
scoped destinations use only the parsed slug or the durable resolved slug. The
shared slug normalizer and validator remain the single web contract.

A narrow `@bap/db` read returns the subject's attributed creation count and
granted total so `/organizations/new` can derive non-negative remaining quota
server-side. An absent quota row or database error fails closed to zero. Member
role and removal actions prevent the visible workflow from removing the final
owner before delegating ownership. Owners may assign all three roles and manage
owner targets. Admins may assign only `admin` or `member` and receive no role or
removal controls for owner targets. Members are read-only. Better Auth remains
the permission boundary.

## Security

The browser supplies only names, slugs, invitation email/role, and member ids.
Session identity, membership, organization id, current role, quota, and redirect
paths are re-derived server-side. Malformed, protocol-relative-looking, and
encoded-looking scoped slugs reach only the fixed same-origin failure redirect
with no resolver or provider side effect. All negative action outcomes are
generic and no identifier, email, provider response, token, or credential is
logged. The Phase 8 explicit-id hook, disabled active-organization endpoints,
deletion disable, and the Phase 9 nonmember 404 boundary remain intact.

## Verification

Add one colocated test per page plus focused accessor/action/config coverage.
Prove validation is side-effect-free, zero quota removes the complete form,
every scoped call carries the resolved organization id, forged form ids cannot
retarget an action, invalid scoped slugs have no side effects, owner safeguards
run, admin controls match installed permissions, and failures are generic. Run
focused DB/web tests, full integration and web gates, exact `pnpm check`, scoped
Prettier, stale-contract scans, and `git diff --check`. Walk the full loop
through the real Caddy route using native keyboard interaction, axe, a mobile
viewport, and 640 CSS-pixel layout-equivalent reflow without page/console errors
or horizontal overflow. Record true browser zoom only as separate dated local
evidence.

## Open questions

None. Publishing `/organizations` advances the reserved-slug contract through a
new forward migration; the already-applied Phase 7 migration remains immutable.
The installed Better Auth last-owner checks have known concurrency and
cross-owner gaps which the approved plan assigns to a tested follow-up. This
temporary UI rechecks the visible action, but does not claim to close those
global gaps.
