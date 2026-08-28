CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS app;
CREATE SCHEMA IF NOT EXISTS reporting;
CREATE SCHEMA IF NOT EXISTS bap_migrations;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA auth, app, reporting, bap_migrations FROM PUBLIC;

CREATE TABLE IF NOT EXISTS auth."user" (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  email_verified boolean NOT NULL DEFAULT false,
  image text,
  role text NOT NULL DEFAULT 'user',
  banned boolean NOT NULL DEFAULT false,
  ban_reason text,
  ban_expires timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auth.session (
  id text PRIMARY KEY,
  expires_at timestamptz NOT NULL,
  token text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  ip_address text,
  user_agent text,
  active_organization_id text,
  user_id text NOT NULL REFERENCES auth."user"(id) ON DELETE CASCADE,
  impersonated_by text
);

CREATE INDEX IF NOT EXISTS session_user_id_idx ON auth.session(user_id);

CREATE TABLE IF NOT EXISTS auth.account (
  id text PRIMARY KEY,
  account_id text NOT NULL,
  issuer text NOT NULL,
  provider_id text NOT NULL,
  user_id text NOT NULL REFERENCES auth."user"(id) ON DELETE CASCADE,
  access_token text,
  refresh_token text,
  id_token text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scope text,
  password text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS account_user_id_idx ON auth.account(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS account_issuer_account_id_key ON auth.account(issuer, account_id);

CREATE TABLE IF NOT EXISTS auth.verification (
  id text PRIMARY KEY,
  identifier text NOT NULL,
  value text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS verification_identifier_idx ON auth.verification(identifier);

CREATE TABLE IF NOT EXISTS auth.organization (
  id text PRIMARY KEY,
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  logo text,
  metadata text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auth.member (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES auth.organization(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES auth."user"(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT member_organization_user_key UNIQUE (organization_id, user_id)
);

CREATE INDEX IF NOT EXISTS member_user_id_idx ON auth.member(user_id);

CREATE TABLE IF NOT EXISTS auth.invitation (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES auth.organization(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text,
  status text NOT NULL,
  expires_at timestamptz NOT NULL,
  inviter_id text NOT NULL REFERENCES auth."user"(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS invitation_organization_id_idx ON auth.invitation(organization_id);

CREATE TABLE IF NOT EXISTS auth.jwks (
  id text PRIMARY KEY,
  public_key text NOT NULL,
  private_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  alg text,
  crv text
);

CREATE TABLE IF NOT EXISTS auth.rate_limit (
  id text PRIMARY KEY,
  key text NOT NULL,
  count integer NOT NULL,
  last_request bigint NOT NULL,
  CONSTRAINT rate_limit_key_key UNIQUE (key)
);

CREATE TABLE IF NOT EXISTS bap_migrations.schema_migrations (
  id text PRIMARY KEY,
  checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);

ALTER DEFAULT PRIVILEGES IN SCHEMA auth REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA reporting REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA auth REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA reporting REVOKE ALL ON SEQUENCES FROM PUBLIC;

GRANT USAGE ON SCHEMA auth TO bap_auth, bap_api, bap_reporting, bap_backup;
GRANT USAGE ON SCHEMA app TO bap_backup;
GRANT USAGE ON SCHEMA reporting TO bap_backup;
GRANT USAGE ON SCHEMA bap_migrations TO bap_backup;
GRANT USAGE ON SCHEMA bap_migrations TO bap_auth, bap_api, bap_reporting;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA auth TO bap_auth;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA auth TO bap_auth;
ALTER DEFAULT PRIVILEGES IN SCHEMA auth GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO bap_auth;
ALTER DEFAULT PRIVILEGES IN SCHEMA auth GRANT USAGE, SELECT ON SEQUENCES TO bap_auth;

GRANT SELECT ON ALL TABLES IN SCHEMA auth, app, reporting, bap_migrations TO bap_backup;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA auth, app, reporting, bap_migrations TO bap_backup;
ALTER DEFAULT PRIVILEGES IN SCHEMA auth GRANT SELECT ON TABLES TO bap_backup;
ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT SELECT ON TABLES TO bap_backup;
ALTER DEFAULT PRIVILEGES IN SCHEMA reporting GRANT SELECT ON TABLES TO bap_backup;
ALTER DEFAULT PRIVILEGES IN SCHEMA bap_migrations GRANT SELECT ON TABLES TO bap_backup;
ALTER DEFAULT PRIVILEGES IN SCHEMA auth GRANT SELECT ON SEQUENCES TO bap_backup;
ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT SELECT ON SEQUENCES TO bap_backup;
ALTER DEFAULT PRIVILEGES IN SCHEMA reporting GRANT SELECT ON SEQUENCES TO bap_backup;
ALTER DEFAULT PRIVILEGES IN SCHEMA bap_migrations GRANT SELECT ON SEQUENCES TO bap_backup;

CREATE OR REPLACE FUNCTION auth.resolve_membership(subject_id text, organization_id text)
RETURNS TABLE(email_verified boolean, role text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, auth
AS $$
  SELECT u.email_verified, m.role
  FROM auth.member AS m
  INNER JOIN auth."user" AS u ON u.id = m.user_id
  WHERE m.user_id = $1
    AND m.organization_id = $2
    AND u.email_verified = true
$$;

ALTER FUNCTION auth.resolve_membership(text, text) OWNER TO bap_owner;
REVOKE ALL ON FUNCTION auth.resolve_membership(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.resolve_membership(text, text) TO bap_api, bap_reporting;

CREATE OR REPLACE FUNCTION bap_migrations.current_migration_version()
RETURNS TABLE(version text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, bap_migrations
AS $$
  SELECT max(id) FROM bap_migrations.schema_migrations
$$;

ALTER FUNCTION bap_migrations.current_migration_version() OWNER TO bap_owner;
REVOKE ALL ON FUNCTION bap_migrations.current_migration_version() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bap_migrations.current_migration_version() TO bap_auth, bap_api, bap_reporting;
