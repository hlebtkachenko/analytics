# Account Issuer Column Removal

**Date:** 2026-09-14

## Problem

Better Auth 1.7.3, merged in PR #42, dropped the `issuer` field from its
`account` model and validates the schema at init. Our
`auth.account.issuer text NOT NULL` column, and the
`account_issuer_account_id_key` unique index built on it, no longer match what
Better Auth expects. Better Auth logs
`Database schema mismatch ... account.issuer` and rejects every account insert:
sign-up, account link, and the synthetic-account CLI all fail.

## Scope

- Drop the `issuer` column from `auth.account` and the unique index built on it.
- Replace that index with a unique index on `(provider_id, account_id)`, the
  pair Better Auth 1.7.3 now uses to identify an account, per its upgrade guide
  (drop the index before the column).
- Not in scope: any other Better Auth 1.7.3 model change, since the account
  model is the only one PR #42 flagged as mismatched.

## Design

Migration `20260914.0001_account_issuer_removal.sql`:

- `DROP INDEX IF EXISTS auth.account_issuer_account_id_key`.
- `CREATE UNIQUE INDEX IF NOT EXISTS account_provider_id_account_id_key ON auth.account (provider_id, account_id)`.
- `ALTER TABLE auth.account DROP COLUMN IF EXISTS issuer`.
- `DATABASE_MIGRATION_COMPATIBILITY` in `packages/db/src/access.ts` becomes
  `20260914.0001`.

`packages/db/src/schema.ts` drops the `issuer` column and the
`account_issuer_account_id_key` index from the Drizzle `accounts` table
definition, and adds `account_provider_id_account_id_key` on
`(providerId, accountId)`.

`apps/web/src/lib/auth/models.ts` drops the `issuer` field mapping from
`coreAuthModels.account.fields`, since Better Auth 1.7.3 no longer has that
field on the account model.

## Security

No new data is stored, moved, or logged. The dropped column held no PII beyond
what the surviving `provider_id` and `account_id` pair already identifies.

## Verification

`packages/db/src/postgres.integration.test.ts`: the existing identity-cascade
insert drops the `issuer` value, and a new assertion proves
`information_schema.columns` has no `issuer` column for `auth.account` and that
`pg_indexes` has `account_provider_id_account_id_key` and not
`account_issuer_account_id_key`. `pnpm check`, `pnpm compose:verify`, and
`node scripts/check-node-pins.mjs` run locally; `pnpm test:integration` needs
Docker and runs in CI.

## Open questions

None.
