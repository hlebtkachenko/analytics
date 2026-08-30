-- Better Auth twoFactor plugin schema, mapped to snake_case by twoFactorAuthSchema.
-- Magic link needs no table of its own: it stores and consumes tokens in auth.verification.
-- The runner executes this as bap_owner, so the ALTER DEFAULT PRIVILEGES statements in
-- 20260828.0001 already grant bap_auth DML and bap_backup SELECT on auth.two_factor.
ALTER TABLE auth."user"
  ADD COLUMN IF NOT EXISTS two_factor_enabled boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS auth.two_factor (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES auth."user"(id) ON DELETE CASCADE,
  secret text NOT NULL,
  backup_codes text NOT NULL,
  verified boolean NOT NULL DEFAULT true,
  failed_verification_count integer NOT NULL DEFAULT 0,
  locked_until timestamptz
);

CREATE INDEX IF NOT EXISTS two_factor_user_id_idx ON auth.two_factor(user_id);
CREATE INDEX IF NOT EXISTS two_factor_secret_idx ON auth.two_factor(secret);
