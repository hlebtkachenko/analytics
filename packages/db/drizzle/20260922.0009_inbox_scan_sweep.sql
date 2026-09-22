-- The scan sweep of the inbox maintenance tick: a direct upload or an API push whose blob never got a verdict.
-- Shaped exactly like app.list_stuck_email_items, and organization-less for the same reason: the tick has no tenant.

-- The sweep reads the item to blob link, which no maintenance policy admitted yet; SELECT only, bap_owner only.
CREATE POLICY inbox_item_file_maintenance_select ON app.inbox_item_file FOR SELECT
  TO bap_owner USING (true);

CREATE OR REPLACE FUNCTION app.list_unscanned_inbox_items(stale interval, max_rows integer)
RETURNS TABLE (item_id uuid, channel_id uuid, organization_id text, created_by text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app
AS $$
DECLARE
  floored_stale interval := greatest(list_unscanned_inbox_items.stale, interval '10 minutes');
BEGIN
  IF coalesce(current_setting('bap.organization_id', true), '') <> '' THEN
    RAISE EXCEPTION 'Inbox maintenance runs outside tenant context'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
    SELECT item.id, item.channel_id, item.organization_id, item.created_by
    FROM app.inbox_item AS item
    WHERE item.channel_kind IN ('upload', 'api')
      AND item.status IN ('received', 'needs_review')
      AND item.received_at < now() - floored_stale
      AND EXISTS (
        SELECT 1
        FROM app.inbox_item_file AS item_file
        INNER JOIN app.blob AS item_blob ON item_blob.id = item_file.blob_id
        WHERE item_file.item_id = item.id
          AND item_blob.scan_status = 'not_scanned')
      -- An API item whose channel is gone would fail the channel gate of every attempt.
      AND (item.channel_id IS NULL OR EXISTS (
        SELECT 1
        FROM app.inbox_channel AS channel
        WHERE channel.id = item.channel_id
          AND channel.enabled
          AND channel.deleted_at IS NULL))
    ORDER BY item.received_at
    -- A null max_rows means zero rows, not all.
    LIMIT greatest(list_unscanned_inbox_items.max_rows, 0);
END;
$$;

ALTER FUNCTION app.list_unscanned_inbox_items(interval, integer) OWNER TO bap_owner;
REVOKE ALL ON FUNCTION app.list_unscanned_inbox_items(interval, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.list_unscanned_inbox_items(interval, integer) TO bap_api;
