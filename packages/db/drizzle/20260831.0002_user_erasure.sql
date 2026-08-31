-- Account deletion records one explicit pending subject for operator-tier erasure.
CREATE TABLE IF NOT EXISTS auth.user_erasure_request (
  user_id text PRIMARY KEY,
  requested_at timestamptz NOT NULL DEFAULT now()
);

-- Auth tables inherit Better Auth DML, so this table needs an explicit exception.
REVOKE ALL ON auth.user_erasure_request FROM bap_auth;
GRANT SELECT ON auth.user_erasure_request TO bap_backup;

CREATE OR REPLACE FUNCTION auth.request_user_erasure(requested_user_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, auth
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM auth."user" AS live_user
    WHERE live_user.id = requested_user_id
  ) THEN
    RAISE EXCEPTION 'User erasure requests require a live identity';
  END IF;

  INSERT INTO auth.user_erasure_request (user_id)
  VALUES (requested_user_id)
  ON CONFLICT (user_id) DO NOTHING;
END;
$$;

ALTER FUNCTION auth.request_user_erasure(text) OWNER TO bap_owner;
REVOKE ALL ON FUNCTION auth.request_user_erasure(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.request_user_erasure(text) TO bap_auth;

CREATE OR REPLACE FUNCTION app.erase_user(subject_user_id text)
RETURNS text
LANGUAGE plpgsql
SET search_path = pg_catalog, app
AS $$
DECLARE
  tombstone text;
BEGIN
  IF coalesce(subject_user_id, '') = '' THEN
    RAISE EXCEPTION 'User erasure requires an explicit subject';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM app.audit_log WHERE user_id = subject_user_id
    UNION ALL
    SELECT 1 FROM app.data_grants WHERE user_id = subject_user_id
    UNION ALL
    SELECT 1 FROM app.dataset WHERE created_by = subject_user_id
  ) THEN
    RETURN NULL;
  END IF;

  tombstone := 'erased_' || gen_random_uuid()::text;

  UPDATE app.audit_log
  SET user_id = tombstone
  WHERE user_id = subject_user_id;

  UPDATE app.data_grants
  SET user_id = tombstone
  WHERE user_id = subject_user_id;

  UPDATE app.dataset
  SET created_by = tombstone
  WHERE created_by = subject_user_id;

  RETURN tombstone;
END;
$$;

ALTER FUNCTION app.erase_user(text) OWNER TO bap_owner;
REVOKE ALL ON FUNCTION app.erase_user(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.erase_user(text) TO bap_eraser;

GRANT USAGE ON SCHEMA app TO bap_eraser;
GRANT SELECT (user_id), UPDATE (user_id) ON app.audit_log TO bap_eraser;
GRANT SELECT (user_id), UPDATE (user_id) ON app.data_grants TO bap_eraser;
GRANT SELECT (created_by), UPDATE (created_by) ON app.dataset TO bap_eraser;
