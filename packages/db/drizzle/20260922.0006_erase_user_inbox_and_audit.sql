-- Both stacks redefined app.erase_user and the member status migration replaced the inbox erasure rules with a body that predates them.
-- This migration re-declares the union: the inbox channel guard and inbox tombstones, plus the member audit resource_id tombstone.
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

  IF subject_user_id LIKE 'channel\_%' THEN
    RAISE EXCEPTION 'User erasure never names a channel';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM app.audit_log WHERE user_id = subject_user_id
    UNION ALL
    SELECT 1 FROM app.audit_log
    WHERE resource_type = 'member' AND resource_id = subject_user_id
    UNION ALL
    SELECT 1 FROM app.dataset WHERE created_by = subject_user_id
    UNION ALL
    SELECT 1 FROM app.legal_entity WHERE created_by = subject_user_id
    UNION ALL
    SELECT 1 FROM app.member_entity_scope
    WHERE user_id = subject_user_id OR updated_by = subject_user_id
    UNION ALL
    SELECT 1 FROM app.legal_entity_access
    WHERE user_id = subject_user_id OR created_by = subject_user_id
    UNION ALL
    SELECT 1 FROM app.document WHERE created_by = subject_user_id
    UNION ALL
    SELECT 1 FROM app.partner WHERE created_by = subject_user_id
    UNION ALL
    SELECT 1 FROM app.document_link WHERE created_by = subject_user_id
    UNION ALL
    SELECT 1 FROM app.blob WHERE created_by = subject_user_id
    UNION ALL
    SELECT 1 FROM app.inbox_item
    WHERE created_by = subject_user_id
      OR assignee_id = subject_user_id
      OR decided_by_user_id = subject_user_id
    UNION ALL
    SELECT 1 FROM app.inbox_item_extraction WHERE created_by = subject_user_id
    UNION ALL
    SELECT 1 FROM app.inbox_event WHERE actor_user_id = subject_user_id
    UNION ALL
    SELECT 1 FROM app.document_file WHERE created_by = subject_user_id
    UNION ALL
    SELECT 1 FROM app.inbox_channel WHERE created_by = subject_user_id
  ) THEN
    RETURN NULL;
  END IF;

  tombstone := 'erased_' || gen_random_uuid()::text;

  UPDATE app.audit_log
  SET user_id = tombstone
  WHERE user_id = subject_user_id;

  -- A member action records its subject as the resource_id, so erasure tombstones that too.
  UPDATE app.audit_log
  SET resource_id = tombstone
  WHERE resource_type = 'member' AND resource_id = subject_user_id;

  UPDATE app.dataset
  SET created_by = tombstone
  WHERE created_by = subject_user_id;

  UPDATE app.legal_entity
  SET created_by = tombstone
  WHERE created_by = subject_user_id;

  DELETE FROM app.legal_entity_access
  WHERE user_id = subject_user_id;

  DELETE FROM app.member_entity_scope
  WHERE user_id = subject_user_id;

  -- Rows the subject wrote for someone else survive, attributed to the tombstone.
  UPDATE app.member_entity_scope
  SET updated_by = tombstone
  WHERE updated_by = subject_user_id;

  UPDATE app.legal_entity_access
  SET created_by = tombstone
  WHERE created_by = subject_user_id;

  UPDATE app.document
  SET created_by = tombstone
  WHERE created_by = subject_user_id;

  UPDATE app.partner
  SET created_by = tombstone
  WHERE created_by = subject_user_id;

  UPDATE app.document_link
  SET created_by = tombstone
  WHERE created_by = subject_user_id;

  UPDATE app.blob
  SET created_by = tombstone
  WHERE created_by = subject_user_id;

  UPDATE app.inbox_item
  SET created_by = tombstone
  WHERE created_by = subject_user_id;

  UPDATE app.inbox_item
  SET assignee_id = tombstone
  WHERE assignee_id = subject_user_id;

  UPDATE app.inbox_item
  SET decided_by_user_id = tombstone
  WHERE decided_by_user_id = subject_user_id;

  UPDATE app.inbox_item_extraction
  SET created_by = tombstone
  WHERE created_by = subject_user_id;

  UPDATE app.inbox_event
  SET actor_user_id = tombstone
  WHERE actor_user_id = subject_user_id;

  UPDATE app.document_file
  SET created_by = tombstone
  WHERE created_by = subject_user_id;

  UPDATE app.inbox_channel
  SET created_by = tombstone
  WHERE created_by = subject_user_id;

  RETURN tombstone;
END;
$$;

ALTER FUNCTION app.erase_user(text) OWNER TO bap_owner;
REVOKE ALL ON FUNCTION app.erase_user(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.erase_user(text) TO bap_eraser;
