# SaaS Foundation Plan

## Status

This Phase 4 plan was researched, challenged through repeated Sol advisor
reviews, corrected, and approved before Phase 5 implementation. It covers SaaS
foundation only. It does not define analytics behavior or visual design.

## Accepted architecture

1. Caddy is the sole public service and terminates TLS.
2. Next.js owns opaque Better Auth sessions and two fixed BFF access routes.
3. NestJS services accept only five-minute Ed25519 resource JWTs with the shared
   `bap-internal-services` audience.
4. PostgreSQL owns organization membership authorization through one hardened
   `SECURITY DEFINER` resolver and RLS-capable transaction context.
5. Every service uses a separate login role and a separately mounted credential
   file.
6. Reviewed SQL migrations run only through an isolated migrator after role
   bootstrap.
7. Pino, Prometheus, private readiness, and correlation IDs form the initial
   observability boundary.
8. A pinned PostgreSQL/restic image proves encrypted backup, repository check,
   retention pruning, and isolated restore without claiming production
   scheduling or off-host durability.

## Identity and access

- Better Auth 1.7.2 is integrated directly instead of through an unsupported or
  beta Nest wrapper.
- Admin, Organization, and JWT/JWKS plugins are server-only.
- Public sign-up, resource-token retrieval, password-recovery mail, verification
  mail, and invitation mutation/acceptance routes are disabled.
- The browser receives no resource JWT. A BFF verifies the opaque session,
  creates one in-memory token, calls one compile-time service URL, and returns
  an allow-listed access response.
- JWT verification requires EdDSA/Ed25519, exact issuer/audience, `sub`, `iat`,
  `exp`, at most five minutes, and no application claims.
- Unknown signing-key IDs trigger one forced JWKS refresh after the normal
  one-hour cache.
- The initial owner is created by a TTY-only image command under an advisory
  lock. No HTTP bootstrap route exists.

## Database isolation

- `bap_owner` is `NOLOGIN` and owns `auth`, `app`, `reporting`, and migration
  objects.
- `bap_migrator`, `bap_auth`, `bap_api`, and `bap_reporting` are `NOINHERIT` and
  `NOBYPASSRLS`.
- Only `bap_migrator` can `SET ROLE bap_owner`.
- `bap_backup` is the documented operational `BYPASSRLS` exception required for
  full `pg_dump`; it has read-only/default read grants and no owner membership,
  DML, DDL, or schema creation.
- Nest roles cannot read auth base tables. They may execute only the membership
  resolver and migration compatibility function.
- Future tenant tables require `organization_id`, a leading index, forced RLS,
  and both `USING` and `WITH CHECK` policies based on transaction-local context.

## Ingress and credential contract

Production networks are `edge` (ACME egress), internal `app`, internal `data`,
and a dedicated non-internal `operations-egress`. PostgreSQL joins only `data`;
Caddy joins only `edge` and `app`. Only one-shot restic clients join
`operations-egress`; backup and restore also join `data`. Caddy blocks `/ready`
and `/metrics` before proxying.

Credential files are source-controlled by name and type only. Runtime values are
mode `0600` host files mounted read-only. Database URLs containing passwords are
not accepted. The exact Compose credentials are:

- `postgres_admin_password`
- `bap_migrator_password`
- `bap_auth_password`
- `bap_api_password`
- `bap_reporting_password`
- `bap_backup_password`
- `better_auth_secret`
- `restic_password`
- `restic_repository`

The approved plan initially named a generic restic backend credential file.
Implementation proved that contract could not safely represent the different
REST, S3, and SFTP authentication models, so it was removed instead of shipping
an inert or executable configuration file. Backend-specific secret mounts remain
owner-dependent.

## CI acceptance

PR-critical jobs remain parallel and target a wall clock under four minutes:
format, lint, typecheck, unit test, build, Compose contract, container smoke,
PostgreSQL integration, Gitleaks, dependency review, package audit, and CodeQL.
Browser and backup/restore operational proofs run on schedule or manually.

## Deferred owner-dependent enablement

Production needs an owner-supplied hostname/origin, DNS, ACME connectivity,
initial owner identity, credential files, off-host restic backend, scheduling,
alerts, and RPO/RTO. Mail, MFA, SSO, queues, OpenTelemetry, billing, uploads,
HA, registry publishing, and deployment automation remain deferred until a real
requirement and operating target exist.

## Primary sources

- [Better Auth Next.js integration](https://better-auth.com/docs/integrations/next)
- [Better Auth JWT plugin](https://better-auth.com/docs/plugins/jwt)
- [Better Auth Organization plugin](https://better-auth.com/docs/plugins/organization)
- [PostgreSQL row security](https://www.postgresql.org/docs/18/ddl-rowsecurity.html)
- [PostgreSQL SET ROLE](https://www.postgresql.org/docs/18/sql-set-role.html)
- [Next.js content security policy](https://nextjs.org/docs/app/guides/content-security-policy)
- [Caddy reverse proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)
- [Restic documentation](https://restic.readthedocs.io/)
