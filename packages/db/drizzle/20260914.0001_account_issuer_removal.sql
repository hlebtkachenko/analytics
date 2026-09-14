-- Better Auth 1.7.3 identifies accounts by provider and account id, issuer is no longer written.

DROP INDEX IF EXISTS auth.account_issuer_account_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS account_provider_id_account_id_key ON auth.account (provider_id, account_id);
ALTER TABLE auth.account DROP COLUMN IF EXISTS issuer;
