-- Inbox email channel (ADR 0016, Phase 1a-email): the address credential, the scan recorder and the sender column.
-- An email channel holds one active email_address credential whose secret is the local part of the address:
-- the token is 32 lowercase hex characters, the local part is in-<token>, the address is <local>@<intake domain>.
-- auth.resolve_channel_credential is unchanged; the email caller lowercases the local part and hashes exactly that,
-- never the full address, so secret_sha256 = sha256('in-<token>') and lookups are case-insensitive.

-- The envelope sender of an email item, filled by the worker from the parsed MIME; display only, never routing input.
ALTER TABLE app.inbox_item
  ADD COLUMN IF NOT EXISTS sender text,
  ADD CONSTRAINT inbox_item_sender_check CHECK (sender IS NULL OR length(sender) BETWEEN 1 AND 320);

COMMENT ON COLUMN app.inbox_item.origin IS
  'The credential display prefix for every channel kind: who pushed, never a sender address.';
COMMENT ON COLUMN app.inbox_item.sender IS
  'The parsed From header address of the MIME, unverified, display only, never MAIL FROM.';

-- The intake domain is shared by every organization, so an address is unique across the platform, not per tenant.
CREATE UNIQUE INDEX IF NOT EXISTS inbox_channel_email_address_key
  ON app.inbox_channel(email_address)
  WHERE email_address IS NOT NULL;

-- FORCE row level security applies to the definer too, and blob_update stays closed to the channel:
-- this policy admits only bap_owner, which only the definer below ever runs as, inside the caller's organization.
CREATE POLICY blob_maintenance_update ON app.blob FOR UPDATE
  TO bap_owner
  USING (organization_id = current_setting('bap.organization_id', true))
  WITH CHECK (organization_id = current_setting('bap.organization_id', true));

-- The worker records a scan verdict under the channel role; scan_status is the only column it can ever change.
CREATE OR REPLACE FUNCTION app.record_blob_scan(blob_id uuid, status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app
AS $$
DECLARE
  context_organization_id text := current_setting('bap.organization_id', true);
BEGIN
  IF coalesce(context_organization_id, '') = '' THEN
    RAISE EXCEPTION 'Blob scans require tenant context'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF record_blob_scan.status IS NULL
    OR record_blob_scan.status NOT IN ('clean', 'infected', 'failed') THEN
    RAISE EXCEPTION 'Unknown blob scan status'
      USING ERRCODE = 'check_violation',
            CONSTRAINT = 'blob_scan_status_check';
  END IF;

  UPDATE app.blob AS blob
  SET scan_status = record_blob_scan.status
  WHERE blob.id = record_blob_scan.blob_id
    AND blob.organization_id = context_organization_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Blob was not found'
      USING ERRCODE = 'no_data_found';
  END IF;
END;
$$;

ALTER FUNCTION app.record_blob_scan(uuid, text) OWNER TO bap_owner;
REVOKE ALL ON FUNCTION app.record_blob_scan(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.record_blob_scan(uuid, text) TO bap_api;

-- The signature gains the intake domain, so the two argument function goes and its grants are restated below.
DROP FUNCTION auth.issue_channel_credential(uuid, text);

-- Tenant identity comes from the transaction context, never from an argument, so a caller cannot name another tenant.
-- Returns the plain secret exactly once; the row keeps sha256 and an 8 character display prefix.
-- The kind must match the channel: an api channel issues only api_token, an email channel only email_address.
-- The active limit is per kind: two api_token rows let a rotation overlap, one email_address row is revoked and reissued.
CREATE FUNCTION auth.issue_channel_credential(channel_id uuid, kind text, intake_domain text DEFAULT NULL)
RETURNS TABLE (credential_id uuid, secret text, display_prefix text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, auth
AS $$
DECLARE
  context_organization_id text := current_setting('bap.organization_id', true);
  context_user_id text := current_setting('bap.user_id', true);
  channel_kind text;
  expected_kind text;
  active_total integer;
  active_limit integer;
  email_token text;
  local_part text;
  plain_secret text;
  secret_hash text;
  secret_prefix text;
BEGIN
  IF coalesce(current_setting('bap.role', true), '') <> 'owner' THEN
    RAISE EXCEPTION 'Channel credentials are issued by an owner'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF coalesce(context_organization_id, '') = '' OR coalesce(context_user_id, '') = '' THEN
    RAISE EXCEPTION 'Channel credentials require tenant context'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF issue_channel_credential.kind IS NULL
    OR issue_channel_credential.kind NOT IN ('api_token', 'email_address') THEN
    RAISE EXCEPTION 'Unknown channel credential kind'
      USING ERRCODE = 'check_violation',
            CONSTRAINT = 'inbox_channel_credential_kind_check';
  END IF;

  SELECT channel.kind
  INTO channel_kind
  FROM app.inbox_channel AS channel
  WHERE channel.id = issue_channel_credential.channel_id
    AND channel.organization_id = context_organization_id
    AND channel.deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Channel was not found'
      USING ERRCODE = 'no_data_found';
  END IF;

  expected_kind := CASE channel_kind WHEN 'api' THEN 'api_token' WHEN 'email' THEN 'email_address' END;

  IF issue_channel_credential.kind IS DISTINCT FROM expected_kind THEN
    RAISE EXCEPTION 'Credential kind does not match the channel kind'
      USING ERRCODE = 'check_violation',
            CONSTRAINT = 'inbox_channel_credential_kind_match';
  END IF;

  IF issue_channel_credential.kind = 'email_address'
    AND coalesce(issue_channel_credential.intake_domain, '') = '' THEN
    RAISE EXCEPTION 'An email address credential requires the intake domain'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Serializes issuance per channel so two concurrent calls cannot both see one active credential.
  PERFORM pg_advisory_xact_lock(hashtext(issue_channel_credential.channel_id::text));

  SELECT count(*)::integer
  INTO active_total
  FROM auth.inbox_channel_credential AS credential
  WHERE credential.channel_id = issue_channel_credential.channel_id
    AND credential.kind = issue_channel_credential.kind
    AND credential.revoked_at IS NULL;

  active_limit := CASE issue_channel_credential.kind WHEN 'api_token' THEN 2 ELSE 1 END;

  IF active_total >= active_limit THEN
    RAISE EXCEPTION 'A channel holds at most % active credentials of kind %',
      active_limit, issue_channel_credential.kind
      USING ERRCODE = 'check_violation',
            CONSTRAINT = 'inbox_channel_credential_active_limit';
  END IF;

  IF issue_channel_credential.kind = 'api_token' THEN
    plain_secret := 'bap_intake_'
      || translate(rtrim(encode(public.gen_random_bytes(32), 'base64'), '='), '+/', '-_');
    secret_hash := encode(sha256(convert_to(plain_secret, 'UTF8')), 'hex');
    secret_prefix := substr(plain_secret, length('bap_intake_') + 1, 8);
  ELSE
    -- 128 bits of entropy as lowercase hex; the hash covers the local part only, so the domain may change later.
    email_token := encode(public.gen_random_bytes(16), 'hex');
    local_part := 'in-' || email_token;
    plain_secret := local_part || '@' || issue_channel_credential.intake_domain;
    secret_hash := encode(sha256(convert_to(local_part, 'UTF8')), 'hex');
    secret_prefix := substr(email_token, 1, 8);
  END IF;

  INSERT INTO auth.inbox_channel_credential (
    organization_id, channel_id, kind, secret_sha256, display_prefix, created_by
  )
  VALUES (
    context_organization_id,
    issue_channel_credential.channel_id,
    issue_channel_credential.kind,
    secret_hash,
    secret_prefix,
    context_user_id
  )
  RETURNING
    inbox_channel_credential.id,
    plain_secret,
    inbox_channel_credential.display_prefix
  INTO credential_id, secret, display_prefix;

  -- The owner must read the address to hand it out, so the channel row carries it plain; the platform unique index guards it.
  IF issue_channel_credential.kind = 'email_address' THEN
    UPDATE app.inbox_channel AS channel
    SET email_address = plain_secret, updated_at = now()
    WHERE channel.id = issue_channel_credential.channel_id
      AND channel.organization_id = context_organization_id;
  END IF;

  RETURN NEXT;
END;
$$;

ALTER FUNCTION auth.issue_channel_credential(uuid, text, text) OWNER TO bap_owner;
REVOKE ALL ON FUNCTION auth.issue_channel_credential(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.issue_channel_credential(uuid, text, text) TO bap_api;

-- True when a live credential of the caller's organization was revoked by this call, false otherwise.
-- Revoking an email_address credential clears the address from the channel row, so nothing lists a dead address.
CREATE OR REPLACE FUNCTION auth.revoke_channel_credential(credential_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, auth
AS $$
DECLARE
  context_organization_id text := current_setting('bap.organization_id', true);
  revoked_kind text;
  revoked_channel_id uuid;
BEGIN
  IF coalesce(current_setting('bap.role', true), '') <> 'owner' THEN
    RAISE EXCEPTION 'Channel credentials are revoked by an owner'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF coalesce(context_organization_id, '') = '' THEN
    RAISE EXCEPTION 'Channel credentials require tenant context'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE auth.inbox_channel_credential AS credential
  SET revoked_at = now()
  WHERE credential.id = revoke_channel_credential.credential_id
    AND credential.organization_id = context_organization_id
    AND credential.revoked_at IS NULL
  RETURNING credential.kind, credential.channel_id
  INTO revoked_kind, revoked_channel_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF revoked_kind = 'email_address' THEN
    UPDATE app.inbox_channel AS channel
    SET email_address = NULL, updated_at = now()
    WHERE channel.id = revoked_channel_id
      AND channel.organization_id = context_organization_id;
  END IF;

  RETURN true;
END;
$$;

ALTER FUNCTION auth.revoke_channel_credential(uuid) OWNER TO bap_owner;
REVOKE ALL ON FUNCTION auth.revoke_channel_credential(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.revoke_channel_credential(uuid) TO bap_api;
