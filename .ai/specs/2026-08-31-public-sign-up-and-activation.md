# Public Sign-up and Activation

## Problem

Email/password registration previously had no browser entry point. The platform
needs a runtime, default-off public sign-up control without giving the web
runtime authority to change it, while invitation onboarding must continue when
the switch is off. The browser also needs one coherent identity flow for sign
in, activation, and password recovery.

## Scope

Add the operator-owned switch, enable the Better Auth email sign-up endpoint,
and allow either an enabled switch or a pending, unexpired invitation. Keep
email verification as account activation and keep duplicate responses
indistinguishable. Add Carbon browser pages for sign in, sign up, activation,
password recovery, and the post-activation welcome. This work does not add
organization self-service, membership creation, social login, or two-factor
enrolment.

## Design

Migration `20260831.0001` adds `auth.platform_setting` and seeds
`public_signup=false`. `auth.public_signup_enabled()` returns false for a
missing row and is the only read granted to `bap_auth`; inherited auth-table DML
is revoked. The database CLI supports `signup enable|disable|status` through the
existing migrator credential and emits JSON.

The Next.js route first consumes an atomic 3-per-60-second edge bucket in
`auth.rate_limit`. It uses only Caddy's `x-bap-client-ip`, validates that value
as an IP address, rejects scoped IPv6 identities, and shares one fallback bucket
for an absent or malformed value. IPv4 stays /32; IPv6 is canonicalized to /64
before hashing. The edge key namespace is separate from Better Auth's
independent rate limit. An exhausted bucket returns 429 with retry metadata,
remains capped at 3, and receives no conflict update until its window expires.
The same atomic statement prunes expired keys only from the edge namespace,
using a partial `last_request` index. Otherwise the route rejects non-JSON
content types, clones and validates JSON, and checks admission before dispatch.
Malformed and unsupported bodies consume the edge attempt and fail closed with
`PUBLIC_SIGN_UP_DISABLED`.

Better Auth repeats admission in its exact `/sign-up/email` before-hook. Both
policy layers query a case-insensitive pending, unexpired invitation first, then
the switch. Either layer fails closed. Better Auth remains responsible for
password validation, duplicate anti-enumeration, user creation, verification
mail, and its own second rate-limit bucket. A custom synthetic user includes the
Admin and Two Factor plugin fields.

The browser identity routes share `app/(identity)/layout.tsx`. Its bare Carbon
layout is one `Grid` containing a `Column` sized to 4 small columns, 6 medium
columns offset by 1, and 6 large columns offset by 5. One CSS-module rule adds
vertical padding with a design-system spacing token. The route group does not
change public URLs, and the pages contain no tile, UI shell, or header.

`/sign-up` reads `publicSignupEnabled()` on the server and renders no form when
the read is false or fails. The form accepts name, email, and a 14-128 character
password, then calls Better Auth with the relative `/activate` callback. Fresh
and duplicate-address successes discard the framework payload and render the
same generic result. `/forgot-password` similarly uses only the relative
`/reset-password` callback and renders the same success for existing and
nonexistent addresses. The proxy canonicalizes reset callbacks before a page
render. Exactly 1 token in Better Auth's installed 24-character shape is moved
into a 30-minute `HttpOnly`, `SameSite=Lax` cookie scoped to `/reset-password`,
with `Secure` enabled in production, then redirected to the clean path. A
callback error, malformed token, or duplicate token clears that capability. A
clean request without a valid capability reaches the same generic no-form state.
These redirects and the clean reset page use `Referrer-Policy: no-referrer`.
Exact proxy matcher entries keep reset and activation canonicalization active
even when either supported prefetch header is present; the generic matcher
retains its prefetch exclusions for other routes.

The reset page gives its Client Component only a capability-present boolean. Its
Server Action reads the path-scoped cookie and validates the 14-128 character
password and confirmation. It dispatches a `Request` to Better Auth's in-process
HTTP handler at a fixed non-routable URL so the installed router rate limiter
and hooks execute without an outbound fetch. The dispatch forwards only JSON
content type and the Caddy-established client-IP header, never the incoming
Host, origin, or cookies. The Client Component never receives the token in a
prop, action argument, form field, log, or visible message. A mismatch leaves
the capability available for correction. Success and terminal invalidity clear
it, and every Better Auth failure becomes the same generic result.

`/activate` has three server-rendered outcomes. The proxy canonicalizes any raw
callback error to the fixed `/activate?state=invalid` URL with
`Referrer-Policy: no-referrer`; that state gives generic invalid-or-expired
guidance without reflecting its code. A live session redirects to `/welcome`,
and no session gives scanner-consumption guidance with a sign-in link.
`/welcome` redirects an unauthenticated request to `/sign-in`. The existing
sign-in and two-factor pages keep their URLs, add password-recovery navigation,
and use the same Carbon error-notification contract as the new forms.

## Security

Only `bap_migrator` may assume `bap_owner` and change the switch. No runtime
role may read or write its table directly. Submitted addresses are query
parameters and are never logged. A policy or rate-limit database error returns
`PUBLIC_SIGN_UP_DISABLED` without reflecting its cause. Verification activates
the account and automatically creates a session; sign-up itself creates neither
a session nor an organization membership. The existing accepted two-factor
caveat for automatic sign-in after verification remains. Caddy overwrites the
client header publicly, but direct internal web-service access can still spoof a
valid prefix and must remain excluded by the deployment topology.

Switch and session reads remain server-only. Browser forms send only relative
callback paths. The reset capability exists only in the callback request and the
path-scoped `HttpOnly` cookie, never in production HTML, an RSC payload, client
state, or a Server Action argument. No page renders or logs a reset token,
activation error code, Better Auth error, or database error. Auth failures use a
non-dismissible, low-contrast Carbon `InlineNotification` with `kind="error"`
and `role="alert"`. No outcome distinguishes whether an email address already
belongs to an account.

## Verification

Focused web tests drive the exported POST route, a direct Better Auth API
dispatch, and every identity page export. Backend coverage includes switch-off,
switch-on, invitation bypass, failed reads, edge exhaustion, cloned JSON,
malformed and unsupported bodies, exact rates, and the synthetic response. Page
coverage includes switch-on/off and failed switch reads, identical fresh and
duplicate success, identical existing and nonexistent recovery success, all 3
activation branches, reset callback errors with no form, and unauthenticated
welcome redirection. Database CLI and PostgreSQL integration coverage retains
the switch, grant, rate-limit, invitation, backup, and default-privilege proofs.
The production browser regression proves callback redirect and cookie
attributes, sentinel absence from HTML and RSC responses, exact keyboard focus
order, expected Chromium accessibility-tree roles and names, and zero axe
violations across representative identity states. It repeats reset-token,
reset-error-plus-token, and activation-error callbacks with both
`Purpose: prefetch` and `Next-Router-Prefetch` RSC requests. An isolated
installed-router test proves the reset completion rule allows 5 attempts and
returns 429 on the 6th.

On 2026-08-31, macOS 26 and Google Chrome for Testing 151.0.7922.34 passed a
headed 200% browser-tab zoom check on `/sign-in`. Chrome reported zoom factor 2,
a 640 CSS-pixel viewport inside a 1280-pixel-wide window, DPR 4, no horizontal
overflow, and the expected email, password, password-visibility, recovery-link,
and submit focus order. VoiceOver verification was attempted on the same host
but was not completed: Orca could see the Chrome window, while macOS denied its
accessibility-window attachment with `permission_denied`; Apple Events UI
control was denied as well. This is not recorded as a VoiceOver pass, and a
human VoiceOver confirmation remains outstanding.

Run focused tests, workspace typecheck, the full repository gate, browser checks
through the real local stack, stale wording scans, and `git diff --check`.

## Open questions

None.
