-- The fourth definer of ADR 0016: the settings page lists the active credentials of a channel by prefix only.
-- bap_api holds no SELECT on auth.inbox_channel_credential, so the list goes through this function with the same
-- owner and organization checks as issue and revoke. Revoked rows never appear; the hash never leaves the table.
CREATE OR REPLACE FUNCTION auth.list_channel_credentials(channel_id uuid)
RETURNS TABLE (
  credential_id uuid,
  kind text,
  display_prefix text,
  created_at timestamptz,
  last_used_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, auth
AS $$
DECLARE
  context_organization_id text := current_setting('bap.organization_id', true);
BEGIN
  IF coalesce(current_setting('bap.role', true), '') <> 'owner' THEN
    RAISE EXCEPTION 'Channel credentials are listed by an owner'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF coalesce(context_organization_id, '') = '' THEN
    RAISE EXCEPTION 'Channel credentials require tenant context'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  SELECT credential.id, credential.kind, credential.display_prefix, credential.created_at, credential.last_used_at
  FROM auth.inbox_channel_credential AS credential
  WHERE credential.channel_id = list_channel_credentials.channel_id
    AND credential.organization_id = context_organization_id
    AND credential.revoked_at IS NULL
  ORDER BY credential.created_at, credential.id;
END;
$$;

ALTER FUNCTION auth.list_channel_credentials(uuid) OWNER TO bap_owner;
REVOKE ALL ON FUNCTION auth.list_channel_credentials(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.list_channel_credentials(uuid) TO bap_api;
