# Public Sign-up and Activation

## Problem

The authentication configuration retains an email-link sign-in path and awaits
mail transport delivery in hooks. Its password and email-verification settings
do not yet express the Phase 1 activation policy.

## Scope

Remove email-link sign-in and its template and rate rules. Keep public email
sign-up disabled for Phase 1, strengthen the configured password policy, and
configure verified-email activation. Mail submission for password reset,
verification, and invitations becomes best-effort and non-blocking. This does
not add public sign-up, an activation UI, or two-factor enrolment.

## Design

`apps/web/src/lib/auth/server.ts` configures Better Auth with a 14-128 character
password policy, verified-email requirements, reset session revocation, and
30-minute verification links. Verification creates a browser session after
success. `/change-email` is disabled with the existing BFF-only and invite-only
paths. The three sender factories dispatch through the existing mail module
without awaiting transport completion.

## Security

Passwords are validated by Better Auth at the auth boundary and never logged.
Mail hooks send only the address and provider URL already supplied by Better
Auth. Sender failures do not reveal mail-provider status to callers. Automatic
sign-in after verification mints a session without a two-factor challenge.
`/two-factor/enable` is live but requires an authenticated session and password.
Ordinary unverified users cannot get that session because email/password sign-up
does not sign them in and password sign-in requires verified email; already
verified users return early from email verification. Before any flow can leave
an authenticated, two-factor-enabled account unverified, set
`autoSignInAfterVerification` to `false` or enforce two factor during
verification.

## Verification

Focused auth and mail-template tests cover removed routes and templates, and
prove each detached sender resolves before a pending transport and swallows a
transport rejection. Run the web tests and workspace typecheck.

## Open questions

None.
