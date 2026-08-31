-- Organization creator attribution, quota enforcement, and route-safe slugs.
CREATE TABLE auth.organization_quota (
  user_id text PRIMARY KEY
    REFERENCES auth."user"(id) ON DELETE CASCADE,
  granted_total integer NOT NULL DEFAULT 0,
  granted_by text
    REFERENCES auth."user"(id) ON DELETE SET NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  note text,
  CONSTRAINT organization_quota_granted_total_check
    CHECK (granted_total >= 0)
);

CREATE INDEX organization_quota_granted_by_idx
  ON auth.organization_quota(granted_by);

-- auth tables inherit Better Auth DML, but quota changes stay operator-only.
REVOKE ALL ON auth.organization_quota FROM bap_auth;
GRANT SELECT ON auth.organization_quota TO bap_auth;
GRANT SELECT ON auth.organization_quota TO bap_backup;

ALTER TABLE auth.organization
  ADD COLUMN created_by text;

ALTER TABLE auth.organization
  ADD CONSTRAINT organization_created_by_fkey
  FOREIGN KEY (created_by)
  REFERENCES auth."user"(id)
  ON DELETE SET NULL;

CREATE INDEX organization_created_by_idx
  ON auth.organization(created_by);

ALTER TABLE auth.organization
  ADD CONSTRAINT organization_slug_format_check
    CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  ADD CONSTRAINT organization_slug_length_check
    CHECK (char_length(slug) BETWEEN 3 AND 20),
  ADD CONSTRAINT organization_slug_not_numeric_check
    CHECK (slug !~ '^[0-9]+$'),
  ADD CONSTRAINT organization_slug_reserved_check
    CHECK (
      slug NOT IN (
        'access',
        'api',
        'datasets',
        'design-system',
        'health',
        'invitation',
        'metrics',
        'ready',
        'sign-in',
        'sign-up',
        'forgot-password',
        'reset-password',
        'activate',
        'welcome',
        'account'
      )
    );

-- Existing non-scalar values remain readable as legacy data, while every new
-- or changed row must use one of the supported roles.
ALTER TABLE auth.member
  ADD CONSTRAINT member_role_check
    CHECK (role IN ('owner', 'admin', 'member')) NOT VALID;

ALTER TABLE auth.invitation
  ADD CONSTRAINT invitation_role_check
    CHECK (role IN ('owner', 'admin', 'member')) NOT VALID;

CREATE OR REPLACE FUNCTION auth.enforce_organization_creation_quota()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, auth
AS $$
DECLARE
  creator_quota integer;
  created_total integer;
BEGIN
  -- NULL is an unattributed legacy or system organization and consumes no quota.
  IF NEW.created_by IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(NEW.created_by));

  SELECT quota.granted_total
  INTO creator_quota
  FROM auth.organization_quota AS quota
  WHERE quota.user_id = NEW.created_by;

  SELECT count(*)::integer
  INTO created_total
  FROM auth.organization AS organization
  WHERE organization.created_by = NEW.created_by;

  IF created_total >= coalesce(creator_quota, 0) THEN
    RAISE EXCEPTION 'Organization creation quota exceeded'
      USING ERRCODE = 'check_violation',
            CONSTRAINT = 'organization_creation_quota_check';
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION auth.enforce_organization_creation_quota() OWNER TO bap_owner;
REVOKE ALL ON FUNCTION auth.enforce_organization_creation_quota() FROM PUBLIC;

CREATE TRIGGER organization_creation_quota_trigger
BEFORE INSERT ON auth.organization
FOR EACH ROW
EXECUTE FUNCTION auth.enforce_organization_creation_quota();
