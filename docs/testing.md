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

Design-system icon tests pin the exact 18 curated `@bap/design-system/icons`
exports and their intrinsic glyph behavior at the supported 16, 20, 24, and 32px
artboards. A separate TypeScript compiler AST contract parses the actual
production TSX, rejects direct application imports from `@carbon/icons-react`,
and pins the exact 21 reviewed `renderIcon={Identifier}` callsites, facade
imports, visible children, and absence of icon-only props. The AST coverage also
protects the five Phase 10 pages' exact throwaway marker and zero
CSS/design-system/icon boundary. Committed production Playwright coverage
verifies real public and authenticated controls for keyboard order, axe,
label-derived accessible names, 16px Carbon SVG semantics and alignment, 44px
targets, Phase 10 exclusion, console and page errors, and 640 CSS-pixel
layout-equivalent reflow without document overflow. The 640px check is not a
browser-zoom claim; true browser zoom is recorded only as separate dated local
evidence after setting and reading the Chrome tab zoom.

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

Phase 7 database coverage pins organization-quota columns, named constraints,
foreign-key delete actions, direct and default ACLs, trigger identity, function
owner, invoker rights, fixed search path, and revoked execution. It proves an
absent quota rejects attributed creation, NULL attribution consumes no quota,
positive quotas work, `bap_auth` is SELECT-only and cannot disable enforcement,
and two real concurrent inserts at quota 1 produce exactly 1 success. A shared
table-driven corpus covers malformed, overlong, numeric, reserved, and valid
slugs in both PostgreSQL and Zod. Unit tests also prove deterministic
normalization, invalid legacy membership returning no access, and both setup
entrypoints validating before user writes and closing their one-shot migrator
pool before organization creation.

Phase 8 focused auth coverage dispatches the configured Better Auth handler to
prove quota exhaustion returns 403 before writes, raw slugs are normalized
before framework side effects, invalid and reserved results are side-effect
free, forged creator input is discarded, and the authenticated creator becomes
an `owner`. Unit coverage pins the fail-closed `organizationLimit` polarity,
explicit owner and 100-member settings, the 10 bindable active-organization
guards, unconditional hook rejection of `get-active-member`, and all 3 public
disabled organization routes plus normalized outer-route variants. A positive
configured-handler control proves `get-active-member-role` resolves the supplied
organization id rather than ambient session state. Coverage also pins the
10-per-minute slug-check rule. The database CLI suite requires exactly
`--email --total --note`, asserts its single owner-role transaction and
parameter values, and proves rollback plus generic JSON failures. Integration
also reads the resulting note and NULL auth grantor through the real role
boundary. The existing advisory-lock race remains the authoritative concurrency
proof; an application precheck is not treated as race enforcement.

Phase 9 coverage proves the exact parameterized organization/member join,
approved role parsing, and real member, nonmember, and unknown-slug outcomes
through `bap_auth`. Web tests prove malformed slugs reach neither session nor
database work, unauthenticated and unverified requests fail closed, resolver
errors disclose nothing, and the layout uses the same not-found path for every
negative result. The root redirect is pinned to `/organizations`. Separate BFF
and PostgreSQL assertions prove a valid slug-shaped selector can cross the web's
syntax check but cannot resolve as an id at the service membership boundary.
Phase 10 page tests cover every new route: membership listing, quota-positive
and quota-zero creation states, name-to-slug prefill, organization navigation,
explicit-id member and invitation reads, permission-based form visibility, and
settings prefill. Action tests prove normalized creation preserves ambient
session state, forged organization ids are ignored, explicit resolved ids reach
Better Auth, the temporary sole-owner recheck runs, co-owner changes work, and
failures expose only fixed generic outcomes.

PostgreSQL integration keeps the TypeScript and database slug corpus in exact
parity, now including `organizations`. It also runs the forward reservation SQL
inside a rollback-only collision fixture and proves the migration aborts before
replacing the constraint. The real quota reader covers positive, exhausted, and
absent grants through `bap_auth`.

The live Phase 10 browser walk starts from `/organizations`, creates an allowed
organization, and traverses its overview, members, and settings pages through
Caddy. It also covers native keyboard operation, axe, a mobile viewport, 640
CSS-pixel layout-equivalent reflow, horizontal overflow, and page/console
errors. This is not a browser-zoom assertion. The pages intentionally have no
CSS or Carbon imports. The operational workflow raises only its disposable
synthetic owner's total quota from 1 to 2 through the existing migrator command;
the second organization consumes that capacity and the proof finishes on the
zero-quota state. The organization and dataset specs share one worker-scoped
synthetic browser session, while the access spec keeps its independent
sign-in/sign-out proof. This keeps the combined suite inside the unchanged
public sign-in rate limit after the preceding unverified-account check.

The scheduled and manually runnable GitHub Actions operational proof creates a
disposable local Compose stack, creates a gated synthetic account, completes a
browser sign-in and organization-access check, then backs up and restores the
database into a separate service. Before the existing identity suite, it enables
public sign-up through the migrator CLI and runs a serial Caddy-path proof that
returns the switch OFF in both test and workflow cleanup.

Synthetic account creation is a command override of the profiled
`bootstrap-owner` one-shot, not an exec inside long-lived web. The rendered
Compose tests prove only that one-shot combines the auth and migrator credential
boundaries, while web has neither the migrator environment path nor secret
mount. The created quota row is included in the normal backup and restore
surface.

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

The workflow then validates the restored owner membership, minimum initial
quota, and current migration identifier. It does not exercise production data, a
real recipient, external mail delivery, or production infrastructure. The
production Compose contract is separately verified to contain no Mailpit
service, route, SMTP port, or SMTP transport configuration, and no loopback API
proxy or proxy network. The same model probe verifies bootstrap and operations
absence, accepts a valid Mailpit port override, and rejects collisions with web
or PostgreSQL without starting services.

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

The committed icon regression uses the same disposable production stack and a
real authenticated fixture:

```sh
BAP_OPERATIONAL_BASE_URL=http://localhost:3000 pnpm exec playwright test --config playwright.operational.config.ts tests/operational/icons.spec.ts
```

It covers the actual public and authenticated application callsites. The test
creates only disposable synthetic accounts, an invitation, and a 30-row neutral
CSV inside that stack. It does not mock application routes. Its explicit 640
CSS-pixel viewport is the repeatable layout-equivalent check, not browser zoom.

On 2026-08-31, a headed Google Chrome for Testing 151.0.7922.34 check on macOS
26 set the `/sign-in` tab to a true 200% browser zoom. The extension-reported
zoom factor was 2; the 1280-pixel-wide window exposed a 640 CSS-pixel viewport
at DPR 4, the document had no horizontal overflow, and keyboard focus retained
the expected order. This manual zoom result supplements the durable browser
suite.

On 2026-09-01, the Carbon icon follow-up repeated that check in a headed local
Google Chrome for Testing 151.0.7922.34 window on macOS 26. The local extension
called `chrome.tabs.setZoom(2)` and read back a factor of 2 from
`chrome.tabs.getZoom`, with automatic per-origin zoom. The 1280-pixel window
again exposed 640 CSS pixels at DPR 4. The labeled Sign in control retained
keyboard focus and a 48px height; its decorative 16px `currentColor` glyph
remained out of focus and vertically centered within 0.004px. The document did
not overflow and page/application error listeners remained empty. This is dated
manual/local evidence, not CI automation and not a CDP page-scale claim.

VoiceOver verification was attempted on the same date and host but was not
completed. Orca could enumerate the Chrome window, but macOS denied its
accessibility-window attachment with `permission_denied`; Apple Events UI
control was also denied. This is not a VoiceOver pass or an automated VoiceOver
claim. A human VoiceOver confirmation is still required.

The operational-proof synthetic-account command is unavailable unless
`BAP_E2E_SETUP=true` is set. It accepts one strict JSON object on standard input
and emits only status and generated IDs. It is not an HTTP endpoint and must not
be used for interactive owner provisioning.
