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

The scheduled and manually runnable GitHub Actions operational proof creates a
disposable local Compose stack, creates a gated synthetic account, completes a
browser sign-in and organization-access check, then backs up and restores the
database into a separate service. It validates the restored owner membership and
current migration identifier. It does not exercise production data or
infrastructure.

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

The test-only synthetic-account command is unavailable unless
`BAP_E2E_SETUP=true` is set. It accepts one strict JSON object on standard input
and emits only status and generated IDs. It is not an HTTP endpoint and must not
be used for interactive owner provisioning.
