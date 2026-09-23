#!/usr/bin/env bash
# One-command HR demo: disposable accounts and the Wave 0 browser proof.
set -euo pipefail

# shellcheck source=scripts/demo-lib.sh
source "$(dirname -- "${BASH_SOURCE[0]}")/demo-lib.sh"

if [[ ${1:-} == '--down' ]]; then
  demo_down
  exit 0
fi

demo_local_secrets
demo_reset_stack
demo_start_stack
demo_create_accounts
demo_grant_quota

# Test-only Wave 4 fixture. It uses fixed opaque IDs only inside the disposable demo database.
export BAP_HR_SELF_SERVICE_FIXTURE=true
compose exec -T database psql -v ON_ERROR_STOP=1 -U postgres -d bap \
  -v organization_id="$BAP_OPERATIONAL_ORGANIZATION_ID" \
  -v admin_user_id="$BAP_OPERATIONAL_ADMIN_USER_ID" \
  -v member_user_id="$BAP_OPERATIONAL_MEMBER_USER_ID" <<'SQL'
insert into app.legal_entity (id, organization_id, name, kind, registration_number, created_by)
values ('10000000-0000-4000-8000-000000000001', :'organization_id', 'Synthetic self-service entity', 'company', 'SELF-SERVICE', :'admin_user_id');
insert into app.employee (id, organization_id, legal_entity_id, employee_number, first_name, last_name, status, created_by)
values
  ('10000000-0000-4000-8000-000000000011', :'organization_id', '10000000-0000-4000-8000-000000000001', 'SELF-ADMIN', 'Bound', 'Admin', 'active', :'admin_user_id'),
  ('10000000-0000-4000-8000-000000000012', :'organization_id', '10000000-0000-4000-8000-000000000001', 'SELF-MEMBER', 'Bound', 'Member', 'active', :'member_user_id');
insert into app.employment_relationship (id, organization_id, employee_id, kind, position, weekly_hours, start_date, created_by)
values
  ('10000000-0000-4000-8000-000000000021', :'organization_id', '10000000-0000-4000-8000-000000000011', 'employment', 'Synthetic self-service role', 40, '2026-01-01', :'admin_user_id'),
  ('10000000-0000-4000-8000-000000000022', :'organization_id', '10000000-0000-4000-8000-000000000012', 'employment', 'Synthetic self-service role', 40, '2026-01-01', :'member_user_id');
insert into app.employee_user_binding (organization_id, legal_entity_id, employee_id, user_id, created_by)
values
  (:'organization_id', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000011', :'admin_user_id', :'admin_user_id'),
  (:'organization_id', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000012', :'member_user_id', :'member_user_id');
update app.employee_user_binding
set status = 'active', verified_at = now(), updated_at = now()
where organization_id = :'organization_id' and status = 'pending';
insert into app.leave_type (id, organization_id, legal_entity_id, code, name, unit, paid, created_by)
values ('10000000-0000-4000-8000-000000000031', :'organization_id', '10000000-0000-4000-8000-000000000001', 'SELF-LEAVE', 'Synthetic own leave', 'days', true, :'admin_user_id');
insert into app.timesheet (id, organization_id, legal_entity_id, employee_id, relationship_id, period_start, period_end, created_by)
values
  ('10000000-0000-4000-8000-000000000041', :'organization_id', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000011', '10000000-0000-4000-8000-000000000021', '2026-09-01', '2026-09-01', :'admin_user_id'),
  ('10000000-0000-4000-8000-000000000042', :'organization_id', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000012', '10000000-0000-4000-8000-000000000022', '2026-09-02', '2026-09-02', :'member_user_id');
insert into app.time_entry (organization_id, timesheet_id, work_date, starts_at, ends_at, created_by)
values
  (:'organization_id', '10000000-0000-4000-8000-000000000041', '2026-09-01', '2026-09-01T08:00:00Z', '2026-09-01T16:00:00Z', :'admin_user_id'),
  (:'organization_id', '10000000-0000-4000-8000-000000000042', '2026-09-02', '2026-09-02T08:00:00Z', '2026-09-02T16:00:00Z', :'member_user_id');
insert into app.leave_request (id, organization_id, legal_entity_id, employee_id, relationship_id, leave_type_id, starts_on, ends_on, requested_amount, created_by)
values
  ('10000000-0000-4000-8000-000000000051', :'organization_id', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000011', '10000000-0000-4000-8000-000000000021', '10000000-0000-4000-8000-000000000031', '2026-09-10', '2026-09-10', 1, :'admin_user_id'),
  ('10000000-0000-4000-8000-000000000052', :'organization_id', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000012', '10000000-0000-4000-8000-000000000022', '10000000-0000-4000-8000-000000000031', '2026-09-11', '2026-09-11', 1, :'member_user_id');
insert into app.hr_document_category (id, organization_id, legal_entity_id, code, name, confidentiality, retention_key, created_by)
values ('10000000-0000-4000-8000-000000000061', :'organization_id', '10000000-0000-4000-8000-000000000001', 'SELF-DOC', 'Synthetic own document', 'operational', 'self-service', :'admin_user_id');
insert into app.document (id, organization_id, legal_entity_id, kind, title, document_date, created_by)
values
  ('10000000-0000-4000-8000-000000000071', :'organization_id', '10000000-0000-4000-8000-000000000001', 'hr_document', 'Synthetic admin document', '2026-09-01', :'admin_user_id'),
  ('10000000-0000-4000-8000-000000000072', :'organization_id', '10000000-0000-4000-8000-000000000001', 'hr_document', 'Synthetic member document', '2026-09-02', :'member_user_id'),
  ('10000000-0000-4000-8000-000000000073', :'organization_id', '10000000-0000-4000-8000-000000000001', 'payroll', 'Synthetic admin payslip', '2026-09-30', :'admin_user_id'),
  ('10000000-0000-4000-8000-000000000074', :'organization_id', '10000000-0000-4000-8000-000000000001', 'payroll', 'Synthetic member payslip', '2026-09-30', :'member_user_id');
insert into app.employee_document (organization_id, employee_id, document_id, category_id, relationship_id, approval_status, approved_at, created_by)
values
  (:'organization_id', '10000000-0000-4000-8000-000000000011', '10000000-0000-4000-8000-000000000071', '10000000-0000-4000-8000-000000000061', '10000000-0000-4000-8000-000000000021', 'approved', now(), :'admin_user_id'),
  (:'organization_id', '10000000-0000-4000-8000-000000000012', '10000000-0000-4000-8000-000000000072', '10000000-0000-4000-8000-000000000061', '10000000-0000-4000-8000-000000000022', 'approved', now(), :'member_user_id');
insert into app.payroll_run (id, organization_id, legal_entity_id, document_id, payroll_month, status, origin, finalized_by, finalized_at, created_by)
values
  ('10000000-0000-4000-8000-000000000081', :'organization_id', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000073', '2026-09-01', 'finalized', 'imported', :'admin_user_id', now(), :'admin_user_id'),
  ('10000000-0000-4000-8000-000000000082', :'organization_id', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000074', '2026-09-01', 'finalized', 'imported', :'member_user_id', now(), :'member_user_id');
insert into app.payroll_result (id, organization_id, payroll_run_id, employee_id, gross_pay, employee_social, employee_health, income_tax, other_deductions, net_pay, employer_social, employer_health, employer_cost)
values
  ('10000000-0000-4000-8000-000000000091', :'organization_id', '10000000-0000-4000-8000-000000000081', '10000000-0000-4000-8000-000000000011', 1, 0, 0, 0, 0, 1, 0, 0, 1),
  ('10000000-0000-4000-8000-000000000092', :'organization_id', '10000000-0000-4000-8000-000000000082', '10000000-0000-4000-8000-000000000012', 1, 0, 0, 0, 0, 1, 0, 0, 1);
insert into app.payroll_result_document (organization_id, payroll_result_id, document_id, kind, created_by)
values
  (:'organization_id', '10000000-0000-4000-8000-000000000091', '10000000-0000-4000-8000-000000000073', 'payslip', :'admin_user_id'),
  (:'organization_id', '10000000-0000-4000-8000-000000000092', '10000000-0000-4000-8000-000000000074', 'payslip', :'member_user_id');
SQL

printf '== 6/6 Running the HR browser proof\n'
demo_playwright_spec tests/operational/hr.spec.ts

cat <<SUMMARY

The demo stack is still running. Explore it by hand:

  Web            $BAP_OPERATIONAL_BASE_URL
  Mailpit        $BAP_OPERATIONAL_MAILPIT_URL
  Organization   $organization_name (/$organization_slug)

  Owner          $BAP_OPERATIONAL_EMAIL
  Admin          $BAP_OPERATIONAL_ADMIN_EMAIL
  Member         $BAP_OPERATIONAL_MEMBER_EMAIL
  Password       $BAP_OPERATIONAL_PASSWORD

The password is disposable and local. Stop everything with: pnpm demo:hr:down
SUMMARY
