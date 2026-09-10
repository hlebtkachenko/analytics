# Public Sign-up Operational Proof

**Correction (2026-09-01):** The OFF-state browser assertion now expects the
registration form with invitation-only guidance. Admission is still denied for
an uninvited address by both backend policy layers. The wider serial suite keeps
the exact 3-per-60-second sign-in budget with one shared owner sign-in, the
unverified-account denial, and one verified invited-recipient sign-in. The real
invited registration is edge attempt 2 in the same recipient browser context and
Caddy-established bucket as this spec's 4-attempt edge-rate proof.

## Problem

Public sign-up has focused tests, but no live-stack proof that its default-off
switch, anti-enumeration response, rate limit, unverified sign-in block, and
verification delivery hold together through Caddy. The development stack also
lacks a safe mail sink that can prove delivery without using real recipients.

## Scope

Add a serial Playwright proof through the public Caddy endpoint and run it in
the scheduled operational workflow. Add Mailpit and a narrowly constrained SMTP
transport to the development/CI topology only. This work does not change
production Resend delivery, expose Mailpit publicly, add SMTP authentication or
TLS, create organizations, or add post-verification product workflows.

## Design

A separately selected overlay runs a digest-pinned Mailpit service only on the
internal Compose network and supplies the web SMTP override. A non-root,
read-only companion uses a mounted Caddyfile that disables its admin API and
automatic HTTPS, allows only GET `/readyz` and GET `/api/v1/search`, and returns
404 for every other path or method. It binds host loopback with every capability
dropped and no additions. Normal development and operational proof select the
overlay explicitly; bootstrap, production, and operations do not.

The web transport accepts only fixed `mailpit:1025`, disables file and URL
access, and bounds DNS, connection, greeting, and socket phases to 1, 1.5, 1.5,
and 2 seconds as independent fail-fast settings. Verification delivery through
that exact development SMTP transport is awaited before the auth response
resolves. Production Resend and the explicit log transport preserve the
non-blocking mail-hook behavior. Production Compose continues to select Resend
and contains no Mailpit service, proxy, port, route, network, or SMTP variables.

The serial operational spec uses the existing migrator CLI to put sign-up OFF,
prove the invitation-only page and a 403 API response for an uninvited address,
and create a real pending invitation through the owner UI. A unique
`example.test` invitee follows the fixed invitation-page link and submits the
visible sign-up form while the switch remains OFF. That fresh registration is
edge attempt 2. The test then turns the switch ON only to prove sign-in-page
discoverability and repeats the identical request as attempt 3. The responses
must have equal status and exact `Set-Cookie` headers, and bodies must match
after removing only generated user ids and timestamps. Neither response may
contain a token or session cookie. Correct-password sign-in remains blocked for
the unverified user. A fourth sign-up request in that same client bucket must
return 429.

This public sign-up proof polls Mailpit's documented HTTP API for the unique
recipient and records the single fresh verification message without reading its
body, link, or token. SMTP acceptance is part of the fresh auth response
boundary, so the test checks for exactly 1 message after that response. It
checks the recipient id set immediately and again over a short Mailpit
API-consistency window after both the duplicate and fourth responses. That
window is not a bound on SMTP work. In the same consolidated flow, a one-shot
Compose helper reads the invited recipient's message and relays its callback to
the same browser context through a fixed loopback path. The helper writes no
body, link, token, or recipient to output, and tracing is disabled. The browser
consumes the callback, signs in, accepts the intended role, and the owner
changes and removes that membership. The test restores sign-up OFF in a
`finally` block. The workflow also disables sign-up in an unconditional cleanup
step.

## Security

All identities are unique synthetic `example.test` addresses. Passwords,
verification tokens, message bodies, links, and recipient-bearing SMTP errors
must not reach test titles, assertion output, or application logs. SMTP is
cleartext and unauthenticated only between containers on the isolated
development/CI network. The GET-only companion has no UI or mutation surface,
runs with no effective capability, and is absent from bootstrap and production.
The public Caddy configuration has no Mailpit route. The SMTP transport cannot
resolve message file or URL references, returns generic failures, and never logs
mail content. A failed awaited SMTP verification produces a generic public auth
failure even though Better Auth 1.7.2 catches mail-callback errors internally.

## Verification

Unit tests cover fail-closed mail configuration, exact timeout and access
options, generic failures, and no logging. Compose verification asserts the
separate overlay, digest, network, health check, loopback-only valid port,
unique published ports, zero added capabilities, mounted allowlist, absent host
SMTP port, and total absence from bootstrap, production, and operations. Model
probes accept default and overridden ports and reject collisions with web and
PostgreSQL without starting services. Live tests prove the proxy's positive and
negative route/method matrix. Run the operational spec on 3 fresh isolated
stacks, then the existing browser and recovery proof. Run web tests, lint,
typecheck, build, the full repository gate, workflow and stale-wording scans,
scoped Prettier, dependency license/audit checks, and `git diff --check`.

## Open questions

None.
