# Testing

Vitest is the shared test runner. Web tests run in jsdom with React Testing
Library. API tests create real Nest application instances and exercise the
health endpoints through Supertest.

```sh
pnpm test
pnpm test:watch
pnpm test:coverage
```

The initial suite proves:

- the semantic web entry page renders;
- the web health route returns JSON;
- both Nest runtimes compile and answer HTTP health checks;
- invalid API host and port configuration fails at startup.

Coverage is available for local investigation but is not a substitute for
behavioral assertions. Browser automation will be introduced when the web app
has an intentional interactive workflow.
