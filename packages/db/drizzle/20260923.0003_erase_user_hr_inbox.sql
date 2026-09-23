-- Preserve one erasure tombstone across platform, inbox, and HR attribution.
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

  IF subject_user_id LIKE 'system\_%' THEN
    RAISE EXCEPTION 'User erasure never names a system subject';
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
    UNION ALL
    SELECT 1 FROM app.inbox_routing_target
    WHERE created_by = subject_user_id
      OR updated_by = subject_user_id
      OR default_assignee_id = subject_user_id
    UNION ALL
    SELECT 1 FROM app.organization_inbox_setting WHERE created_by = subject_user_id
    UNION ALL
    SELECT 1 FROM app.inbox_rule
    WHERE created_by = subject_user_id OR set_assignee_id = subject_user_id
    UNION ALL
    SELECT 1 FROM app.inbox_correction WHERE created_by = subject_user_id
    UNION ALL SELECT 1 FROM app.employee WHERE created_by = subject_user_id
    UNION ALL SELECT 1 FROM app.employment_relationship WHERE created_by = subject_user_id
    UNION ALL SELECT 1 FROM app.employee_document WHERE created_by = subject_user_id OR approved_by = subject_user_id
    UNION ALL SELECT 1 FROM app.payroll_run WHERE created_by = subject_user_id OR approved_by = subject_user_id OR finalized_by = subject_user_id OR paid_by = subject_user_id
    UNION ALL SELECT 1 FROM app.hr_department WHERE created_by = subject_user_id
    UNION ALL SELECT 1 FROM app.hr_position WHERE created_by = subject_user_id
    UNION ALL SELECT 1 FROM app.hr_cost_centre WHERE created_by = subject_user_id
    UNION ALL SELECT 1 FROM app.hr_workplace WHERE created_by = subject_user_id
    UNION ALL SELECT 1 FROM app.employment_term WHERE created_by = subject_user_id
    UNION ALL SELECT 1 FROM app.employee_status_change WHERE created_by = subject_user_id
    UNION ALL SELECT 1 FROM app.hr_document_category WHERE created_by = subject_user_id
    UNION ALL SELECT 1 FROM app.hr_checklist_template WHERE created_by = subject_user_id
    UNION ALL SELECT 1 FROM app.hr_checklist_template_item WHERE created_by = subject_user_id
    UNION ALL SELECT 1 FROM app.hr_checklist WHERE created_by = subject_user_id
    UNION ALL SELECT 1 FROM app.hr_checklist_task WHERE created_by = subject_user_id OR completed_by = subject_user_id OR owner_user_id = subject_user_id
    UNION ALL SELECT 1 FROM app.hr_access_assignment WHERE created_by = subject_user_id OR user_id = subject_user_id
    UNION ALL SELECT 1 FROM app.payroll_component_definition WHERE created_by = subject_user_id
    UNION ALL SELECT 1 FROM app.employee_compensation_component WHERE created_by = subject_user_id
    UNION ALL SELECT 1 FROM app.payroll_result_component WHERE created_by = subject_user_id
    UNION ALL SELECT 1 FROM app.payroll_liability WHERE created_by = subject_user_id
    UNION ALL SELECT 1 FROM app.payroll_approval WHERE created_by = subject_user_id OR actor_user_id = subject_user_id
    UNION ALL SELECT 1 FROM app.payroll_account_mapping WHERE created_by = subject_user_id
    UNION ALL SELECT 1 FROM app.payroll_result_document WHERE created_by = subject_user_id
    UNION ALL SELECT 1 FROM app.payroll_import WHERE created_by = subject_user_id
    UNION ALL SELECT 1 FROM app.payroll_command_receipt WHERE created_by = subject_user_id
    UNION ALL SELECT 1 FROM app.work_schedule WHERE created_by = subject_user_id
    UNION ALL SELECT 1 FROM app.work_shift WHERE created_by = subject_user_id
    UNION ALL SELECT 1 FROM app.timesheet WHERE created_by = subject_user_id OR approved_by = subject_user_id
    UNION ALL SELECT 1 FROM app.time_entry WHERE created_by = subject_user_id
    UNION ALL SELECT 1 FROM app.leave_type WHERE created_by = subject_user_id
    UNION ALL SELECT 1 FROM app.leave_request WHERE created_by = subject_user_id OR decided_by = subject_user_id
    UNION ALL SELECT 1 FROM app.leave_ledger WHERE created_by = subject_user_id
    UNION ALL SELECT 1 FROM app.absence WHERE created_by = subject_user_id
    UNION ALL SELECT 1 FROM app.employee_user_binding WHERE created_by = subject_user_id OR user_id = subject_user_id
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

  UPDATE app.inbox_routing_target
  SET created_by = tombstone
  WHERE created_by = subject_user_id;

  UPDATE app.inbox_routing_target
  SET updated_by = tombstone
  WHERE updated_by = subject_user_id;

  UPDATE app.inbox_routing_target
  SET default_assignee_id = NULL
  WHERE default_assignee_id = subject_user_id;

  UPDATE app.organization_inbox_setting
  SET created_by = tombstone
  WHERE created_by = subject_user_id;

  UPDATE app.inbox_rule
  SET created_by = tombstone
  WHERE created_by = subject_user_id;

  -- Soft deleted like every rule delete: the slot is freed and the row stays for the items it decided.
  UPDATE app.inbox_rule
  SET set_assignee_id = NULL, enabled = false, priority = NULL, deleted_at = now()
  WHERE set_assignee_id = subject_user_id
    AND deleted_at IS NULL
    AND set_legal_entity_id IS NULL
    AND set_document_kind IS NULL
    AND set_partner_id IS NULL
    AND NOT auto_route;

  UPDATE app.inbox_rule
  SET set_assignee_id = NULL
  WHERE set_assignee_id = subject_user_id;

  UPDATE app.inbox_correction
  SET created_by = tombstone
  WHERE created_by = subject_user_id;

  UPDATE app.employee SET created_by = tombstone WHERE created_by = subject_user_id;
  UPDATE app.employment_relationship SET created_by = tombstone WHERE created_by = subject_user_id;
  UPDATE app.employee_document SET created_by = tombstone WHERE created_by = subject_user_id;
  UPDATE app.employee_document SET approved_by = tombstone WHERE approved_by = subject_user_id;
  UPDATE app.payroll_run SET created_by = tombstone WHERE created_by = subject_user_id;
  UPDATE app.payroll_run SET approved_by = tombstone WHERE approved_by = subject_user_id;
  UPDATE app.payroll_run SET finalized_by = tombstone WHERE finalized_by = subject_user_id;
  UPDATE app.payroll_run SET paid_by = tombstone WHERE paid_by = subject_user_id;
  UPDATE app.hr_department SET created_by = tombstone WHERE created_by = subject_user_id;
  UPDATE app.hr_position SET created_by = tombstone WHERE created_by = subject_user_id;
  UPDATE app.hr_cost_centre SET created_by = tombstone WHERE created_by = subject_user_id;
  UPDATE app.hr_workplace SET created_by = tombstone WHERE created_by = subject_user_id;
  UPDATE app.employment_term SET created_by = tombstone WHERE created_by = subject_user_id;
  UPDATE app.employee_status_change SET created_by = tombstone WHERE created_by = subject_user_id;
  UPDATE app.hr_document_category SET created_by = tombstone WHERE created_by = subject_user_id;
  UPDATE app.hr_checklist_template SET created_by = tombstone WHERE created_by = subject_user_id;
  UPDATE app.hr_checklist_template_item SET created_by = tombstone WHERE created_by = subject_user_id;
  UPDATE app.hr_checklist SET created_by = tombstone WHERE created_by = subject_user_id;
  UPDATE app.hr_checklist_task SET created_by = tombstone WHERE created_by = subject_user_id;
  UPDATE app.hr_checklist_task SET completed_by = tombstone WHERE completed_by = subject_user_id;
  UPDATE app.hr_checklist_task SET owner_user_id = tombstone WHERE owner_user_id = subject_user_id;
  UPDATE app.hr_access_assignment SET created_by = tombstone WHERE created_by = subject_user_id;
  UPDATE app.hr_access_assignment SET user_id = tombstone WHERE user_id = subject_user_id;
  UPDATE app.payroll_component_definition SET created_by = tombstone WHERE created_by = subject_user_id;
  UPDATE app.employee_compensation_component SET created_by = tombstone WHERE created_by = subject_user_id;
  UPDATE app.payroll_result_component SET created_by = tombstone WHERE created_by = subject_user_id;
  UPDATE app.payroll_liability SET created_by = tombstone WHERE created_by = subject_user_id;
  UPDATE app.payroll_approval SET created_by = tombstone WHERE created_by = subject_user_id;
  UPDATE app.payroll_approval SET actor_user_id = tombstone WHERE actor_user_id = subject_user_id;
  UPDATE app.payroll_account_mapping SET created_by = tombstone WHERE created_by = subject_user_id;
  UPDATE app.payroll_result_document SET created_by = tombstone WHERE created_by = subject_user_id;
  UPDATE app.payroll_import SET created_by = tombstone WHERE created_by = subject_user_id;
  UPDATE app.payroll_command_receipt SET created_by = tombstone WHERE created_by = subject_user_id;
  UPDATE app.work_schedule SET created_by = tombstone WHERE created_by = subject_user_id;
  UPDATE app.work_shift SET created_by = tombstone WHERE created_by = subject_user_id;
  UPDATE app.timesheet SET created_by = tombstone WHERE created_by = subject_user_id;
  UPDATE app.timesheet SET approved_by = tombstone WHERE approved_by = subject_user_id;
  UPDATE app.time_entry SET created_by = tombstone WHERE created_by = subject_user_id;
  UPDATE app.leave_type SET created_by = tombstone WHERE created_by = subject_user_id;
  UPDATE app.leave_request SET created_by = tombstone WHERE created_by = subject_user_id;
  UPDATE app.leave_request SET decided_by = tombstone WHERE decided_by = subject_user_id;
  UPDATE app.leave_ledger SET created_by = tombstone WHERE created_by = subject_user_id;
  UPDATE app.absence SET created_by = tombstone WHERE created_by = subject_user_id;
  UPDATE app.employee_user_binding SET created_by = tombstone WHERE created_by = subject_user_id;
  UPDATE app.employee_user_binding SET user_id = tombstone WHERE user_id = subject_user_id;

  RETURN tombstone;
END;
$$;

ALTER FUNCTION app.erase_user(text) OWNER TO bap_owner;
REVOKE ALL ON FUNCTION app.erase_user(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.erase_user(text) TO bap_eraser;
