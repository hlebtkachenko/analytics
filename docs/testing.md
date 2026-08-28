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

- Carbon-backed sign-in and access surfaces render with translated strings;
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

## Integration and operational proof

```sh
pnpm test:integration
```

The scheduled and manually runnable GitHub Actions operational proof creates a
disposable local Compose stack, creates a gated synthetic account, completes a
browser sign-in and organization-access check, then backs up and restores the
database into a separate service. It validates the restored owner membership and
current migration identifier. It does not exercise production data or
infrastructure.

The test-only synthetic-account command is unavailable unless
`BAP_E2E_SETUP=true` is set. It accepts one strict JSON object on standard input
and emits only status and generated IDs. It is not an HTTP endpoint and must not
be used for interactive owner provisioning.
