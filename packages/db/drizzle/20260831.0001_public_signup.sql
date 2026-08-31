-- Public sign-up is enabled only by an operator-controlled runtime setting.
CREATE TABLE IF NOT EXISTS auth.platform_setting (
  "key" text PRIMARY KEY,
  enabled boolean NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO auth.platform_setting ("key", enabled)
VALUES ('public_signup', false)
ON CONFLICT ("key") DO NOTHING;

-- auth tables inherit Better Auth DML grants, but operators alone may change this setting.
REVOKE ALL ON auth.platform_setting FROM bap_auth;
GRANT SELECT ON auth.platform_setting TO bap_backup;

CREATE INDEX IF NOT EXISTS rate_limit_public_signup_edge_last_request_idx
ON auth.rate_limit(last_request)
WHERE "key" LIKE 'bap-edge:public-sign-up:%';

CREATE OR REPLACE FUNCTION auth.public_signup_enabled()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, auth
AS $$
  SELECT COALESCE(
    (
      SELECT platform_setting.enabled
      FROM auth.platform_setting
      WHERE platform_setting."key" = 'public_signup'
    ),
    false
  )
$$;

ALTER FUNCTION auth.public_signup_enabled() OWNER TO bap_owner;
REVOKE ALL ON FUNCTION auth.public_signup_enabled() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.public_signup_enabled() TO bap_auth;
