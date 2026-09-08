# Authenticated navigation and invitation onboarding

**Date:** 2026-09-01

## Problem

Signed-in users can reach `/access` and `/datasets`, but the application has no
shared navigation to organizations or account management. Several access
capabilities look actionable without navigating anywhere. Public sign-up has no
sign-in entry point when enabled, and an unauthenticated invitation recipient
cannot reach the existing invitation exception while public sign-up is off.

## Scope

Add a minimal authenticated shell with one skip link and semantic primary
navigation for Access, Organizations, Datasets, and Account. Keep identity and
invitation pages outside that shell. Add native breadcrumbs to non-main
application pages, a Carbon breadcrumb on the inline dataset view, and connect
the implemented Access actions to real member and upload destinations. Render
unimplemented data-grant and general-assistant capabilities as non-interactive
unavailable status.

Keep the five organization pages and account page deliberately temporary, plain,
and protected by their exact marker comments, with zero CSS,
`@bap/design-system`, or icon imports. This change adds only the semantic links
and forms necessary to exercise their existing workflows. Permanent Carbon
organization and account screens remain future work.

Show public sign-up navigation on sign-in only when the database switch is on.
The sign-up route always renders its existing form: normal public-registration
copy appears while the switch is on, and invitation-only instructions appear
while it is off. The submitted email still passes both existing backend
invitation predicates, so visible or forgeable UI state cannot admit any
uninvited address. For an invitation route, let an unauthenticated visitor use
fixed links to sign in or sign up, then return to the original invitation link
after verification. This does not change rate limits, invitation authorization,
session requirements, roles, quotas, organization ids, or database access.

## Design

The root layout renders a client shell that recognizes only current signed-in
application routes. It adds Carbon's UI shell header and `SkipToContent`, but
leaves each route's existing `main` landmark authoritative. Every application
main uses the fixed `main-content` target. The header supplies both desktop and
collapsible mobile navigation, current-page state, and native links.

The Access organization list validates `slug` alongside immutable `id`. Member
management links to `/{slug}/members`; upload links to
`/datasets?organization={slug}#upload-dataset`. Datasets selects that slug only
when it matches the authenticated organization list, then continues to call the
id-only BFF. Unimplemented capabilities are descriptive tiles, not controls.

The invitation route checks only whether a session exists before rendering.
Signed-out visitors receive generic guidance and exact `/sign-in` and `/sign-up`
links, with no invitation lookup. Signed-in visitors mount the existing client
acceptance flow. The invitation id is never forwarded into sign-up or sign-in as
a prop, form field, query parameter, cookie, visible message, or log value. The
recipient reopens the original invitation link after verification. The real
Better Auth get/accept endpoints still require the recipient session and compare
its email. Organization configuration explicitly pins email verification for
invitation actions instead of relying on Better Auth's id-generation default.

## Security

Pathnames and query slugs choose presentation only. Organization id, membership,
role, quota, and capability decisions remain server-derived. The datasets query
slug is matched against the authenticated organization list before an id-only
BFF request. Form visibility grants no authority; both the edge handler and the
Better Auth before-hook independently query a pending, unexpired invitation for
the submitted email or require public sign-up to be on. Every failure remains
generic and public sign-up ends off. The one-worker operational configuration
disables Playwright tracing and the sensitive lifecycle reports only fixed
errors or sanitized pathnames, so a failure cannot retain the verification
token, invitation id, or invitee address.

## Verification

Unit tests cover shell route inclusion and identity exclusion, one skip target,
active navigation, breadcrumbs, Access destinations and unavailable statuses,
authorized query-slug selection, sign-up discoverability, clean continuation,
and invitation-page signed-out guidance. Preserve the exact temporary-page
source guards.

The serial operational suite uses exactly 3 sign-in requests per 60 seconds: the
public proof's unverified-account denial, the shared synthetic owner session,
and one verified invited recipient. The invited recipient follows the fixed link
and submits the visible sign-up form while the switch is off as attempt 2 in the
recipient browser's 4-attempt edge bucket. A one-shot internal helper reads the
recipient's message and relays its callback to that browser through a fixed
loopback path without writing a body, link, token, or address to output. The
browser consumes the callback, then the recipient signs in, accepts the real
invitation, has their role changed, and is removed. The suite also proves
navigation by activation, permanent destinations, all plain temporary account
and organization workflow pages, public sign-up link visibility, invitation-only
registration copy, keyboard focus, axe, 320px and 640px reflow, and zero
browser/page/HTTP errors. Run focused web tests, full web and design-system
gates, lint, typecheck, build, exact `pnpm check`, Compose verification,
formatting, diff checks, and secret scans. Use only a fresh isolated Compose
project, stop it with plain `down`, and preserve its volumes.

## Open questions

None.
