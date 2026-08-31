# Testing

Vitest is the shared test runner. Web tests run in jsdom with React Testing
Library. API tests create real Nest application instances and exercise the
health endpoints through Supertest.

```sh
pnpm test
pnpm test:watch
pnpm test:coverage
```

The suite proves:

- Carbon-backed identity and access surfaces render with translated strings;
- sign-up, activation, password recovery, and welcome pages preserve their
  server gates, generic outcomes, redirects, and alert semantics;
- the account page gates on a server session and calls the exact Better Auth
  password-change, session-revocation, sign-out, and deletion client methods;
- web health is public while readiness and metrics remain private;
- Better Auth configuration, resource-JWT bounds, BFF response boundaries, CSP,
  bootstrap recovery states, and synthetic-account safeguards behave as
  specified;
- both Nest runtimes compile and answer HTTP health checks;
- invalid API host and port configuration fails at startup;
- database migrations, role access, and migration-compatibility checks hold at
  their boundaries.

Coverage is available for local investigation but is not a substitute for
behavioral assertions.

## Design-system verification

```sh
pnpm design-system:catalog:check
pnpm design-system:test
pnpm design-system:test:browser
pnpm design-system:offline:check
```

The catalog check compares the installed Carbon exports, declarations, tokens,
Sass API, fixtures, and closed-world source mappings. Browser tests execute
Storybook stories with accessibility enforcement. The offline check serves the
static output, rejects remote requests, and verifies the local component, chart,
pattern, visual-asset, and handbook surfaces.

The browser suite includes seven deterministic visual contracts with a 0.5%
pixel mismatch cap and a 0.2 pixelmatch threshold. Chromium baselines are
platform-specific: `chromium-darwin` supports local development and
`chromium-linux` is refreshed in Playwright 1.62.1 Noble for GitHub Actions.

## Integration and operational proof

```sh
pnpm test:integration
```

Two Testcontainers suites run behind that command. The `@bap/db` suite proves
role separation, idempotent migrations, tenant isolation, and that the backup
role can dump the whole database. The `@bap/api` suite proves the worker queue
boundary: a non-partitioned pg-boss queue, a job confined to the organization
named in its payload, a rejected cross-tenant write, an aborted job for revoked
membership, and refused object creation in the `pgboss` schema. It also ingests
a CSV fixture through the real queue and proves that the queued payload carries
identifiers only, that a declared format contradicting the file content fails
the upload with a bounded message, and that the staged file is deleted on both
the success and the failure path.

The database suite also proves the account lifecycle: exact `bap_eraser`
attributes and memberships, no login or CONNECT leakage, exact request and
function ACLs, column-only app grants, comma-composed sole-owner versus co-owner
counts, and the session/account/member/invitation/two-factor cascades. Web tests
also dispatch the configured and public HTTP handlers to prove Admin-plugin user
removal and both impersonation paths are disabled, including normalized path
variants, without minting a session. The same focused coverage asserts the
absence of `adminUserIds`, all 8 reachable admin mutation limits, preservation
of the built-in change-password limit, and the server-only create-user behavior.
Explicit-id erasure must use 1 opaque tombstone across all 3 documented app
columns, consume its pending request transactionally, leave an unrelated
missing-auth fixture untouched, reject live and unrequested ids, and leave
stored state unchanged on a direct repeat. Unit coverage drives CLI role
transitions, rollback, JSON-only output, and redacted errors.

The scheduled and manually runnable GitHub Actions operational proof creates a
disposable local Compose stack, creates a gated synthetic account, completes a
browser sign-in and organization-access check, then backs up and restores the
database into a separate service. Before the existing identity suite, it enables
public sign-up through the migrator CLI and runs a serial Caddy-path proof that
returns the switch OFF in both test and workflow cleanup.

That sign-up proof checks the closed page and a 403 POST while OFF. Because the
edge limiter runs before policy, that denial is attempt 1; fresh sign-up is
attempt 2, its identical duplicate is attempt 3, and a different attempt 4 must
return 429 in the same 60-second Caddy-established client bucket. Fresh and
duplicate must have equal statuses, exact equal `Set-Cookie` headers, bodies
deep-equal after removing only generated ids and timestamps, `token: null`, and
no session cookie. Correct-password sign-in for the new unverified account must
return 403 without a cookie. The development Mailpit API is queried by the
unique synthetic `example.test` recipient: exactly 1 fresh verification message
must appear after the fresh auth response, which awaits development SMTP
acceptance. The recipient id set is checked immediately and finally over a short
Mailpit API-consistency window after both the duplicate and fourth responses.
That window does not bound SMTP work. The test never fetches a message body,
link, or token. It also proves the loopback inspection proxy permits only GET
`/readyz` and GET `/api/v1/search`, returning 404 for the UI, other paths, and
non-GET methods.

The workflow then validates the restored owner membership and current migration
identifier. It does not exercise production data, a real recipient, external
mail delivery, or production infrastructure. The production Compose contract is
separately verified to contain no Mailpit service, route, SMTP port, or SMTP
transport configuration, and no loopback API proxy or proxy network. The same
model probe verifies bootstrap and operations absence, accepts a valid Mailpit
port override, and rejects collisions with web or PostgreSQL without starting
services.

The focused identity browser regression runs against a production Compose stack:

```sh
BAP_OPERATIONAL_BASE_URL=http://localhost:3000 pnpm exec playwright test --config playwright.operational.config.ts tests/operational/identity.spec.ts
```

It proves reset and activation callback canonicalization, the reset cookie's
`HttpOnly`, `Secure`, `SameSite=Lax`, path, and lifetime attributes, and that
sentinel tokens and raw callback codes do not enter production HTML, RSC
responses, action arguments, or visible content. It also drives the identity
recovery path with the keyboard, asserts Chromium accessibility-tree roles and
names, and runs axe against representative identity states. Callback probes
cover ordinary requests plus `Purpose: prefetch` and `Next-Router-Prefetch` RSC
requests for valid reset tokens, reset error-plus-token input, and activation
errors. Focused server coverage uses isolated per-test rate-limit storage with
the installed Better Auth handler and proves reset completion returns 429 on the
6th request after allowing 5.

On 2026-08-31, a headed Google Chrome for Testing 151.0.7922.34 check on macOS
26 set the `/sign-in` tab to a true 200% browser zoom. The extension-reported
zoom factor was 2; the 1280-pixel-wide window exposed a 640 CSS-pixel viewport
at DPR 4, the document had no horizontal overflow, and keyboard focus retained
the expected order. This manual zoom result supplements the durable browser
suite.

VoiceOver verification was attempted on the same date and host but was not
completed. Orca could enumerate the Chrome window, but macOS denied its
accessibility-window attachment with `permission_denied`; Apple Events UI
control was also denied. This is not a VoiceOver pass or an automated VoiceOver
claim. A human VoiceOver confirmation is still required.

The operational-proof synthetic-account command is unavailable unless
`BAP_E2E_SETUP=true` is set. It accepts one strict JSON object on standard input
and emits only status and generated IDs. It is not an HTTP endpoint and must not
be used for interactive owner provisioning.
