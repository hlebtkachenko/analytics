# HR Mechanical Execution Contract

**Status:** authoritative implementation contract **Date:** 2026-09-21 **Applies
to:** HR Waves 0-7

This document removes implementation choices from individual coding tasks. A
worker receives exactly 1 task ID from
[the task packets](hr-execution-tasks.md), applies the contract below, runs the
listed checks, and returns a receipt. A worker must not redesign the contract.

## Authority and stop rules

Repository `AGENTS.md`, security ADRs, and existing cross-application boundaries
remain higher authority. For HR-specific names and behavior, this contract is
authoritative over the partial implementation and the broader roadmap.

A worker must stop and report instead of choosing when:

- an assigned change requires a file outside the task's allowed paths;
- a migration named by the task has already been applied to a shared or
  production database;
- a required external-gate artifact is missing or not marked `approved`;
- an existing repository constraint makes the specified contract impossible;
- a command fails for a reason outside the assigned task after the documented
  bootstrap command has run;
- the task would expose HR values in logs, URLs, audit metadata, queue payloads,
  or model-provider traffic.

Workers must not add dependencies, invent compatibility behavior, modify a
different wave, commit, push, open a pull request, or launch another agent.

## Required worker receipt

Every task returns only:

1. task ID and status (`complete` or `blocked`);
2. changed files;
3. verification commands and results;
4. remaining failure with the first relevant error;
5. confirmation that no files outside the allowed paths changed.

## Workspace bootstrap

Before an API type check or test that resolves `@bap/ai`, run:

```bash
pnpm --filter @bap/ai build
```

The task-specific command follows. The final integrator runs:

```bash
pnpm test:integration
pnpm check
```

No worker treats unrelated pre-existing failures as success. It reports them and
stops after its focused checks pass.

## Database conventions

All new tables live in `app`, use snake_case, forced RLS, and these common
columns unless the table definition below explicitly omits one:

```text
id uuid primary key default gen_random_uuid()
organization_id text not null
created_by text not null
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
unique (id, organization_id)
```

Legal-entity-owned roots also contain `legal_entity_id uuid not null` and use
`foreign key (legal_entity_id, organization_id)` to `app.legal_entity`. Child
tables repeat `organization_id` and use composite parent foreign keys. Text
enums use named check constraints. Money is `numeric(19,4)` and must be
non-negative unless the field explicitly represents a signed adjustment. Hours
are `numeric(7,2)`. Calendar days use `date`; instants use `timestamptz`.

Every tenant table receives:

- `SELECT` policy: organization equals
  `current_setting('bap.organization_id', true)`;
- mutation policy: same organization and `app.role_can_write()`;
- inserts with `created_by` also require
  `created_by = current_setting('bap.user_id', true)`;
- `bap_api` gets only the operations used by an API route;
- `bap_reporting` and `bap_backup` get `SELECT`;
- `bap_eraser` gets only attribution columns required by the single combined
  `app.erase_user(text)` function; no separately callable pre-HR helper exists;
- audit writes use `app.record_audit` with `{}` or identifier/count metadata
  only.

Constraint names are `<table>_<field-or-purpose>_check`, foreign keys are
`<table>_<parent>_fkey`, unique constraints are `<table>_<purpose>_key`, indexes
are `<table>_<purpose>_idx`, and RLS policies are `<table>_select`,
`<table>_insert`, `<table>_update`, and `<table>_delete`. A task does not invent
a different naming scheme.

Finalized payroll facts, approved time facts, supplied input snapshots, and
audit rows receive no `UPDATE` or `DELETE` policy or grant. Corrections insert a
new version. Deferred Czech-law rules, statutory payloads, and receipts follow
the same rule when their separate extension is approved.

## Permission contract

### Capability names

The final access contract contains these HR capabilities:

```text
readHr
manageHr
readPayroll
managePayroll
approvePayroll
readSensitiveHr
manageSensitiveHr
```

### Base role mapping

| Capability                 | Owner | Admin | Member |
| -------------------------- | ----- | ----- | ------ |
| `readHr`                   | true  | true  | false  |
| `manageHr`                 | true  | true  | false  |
| all payroll capabilities   | true  | false | false  |
| all sensitive capabilities | true  | false | false  |

`hr_access_assignment` adds capabilities and never subtracts them. It has:

```text
legal_entity_id uuid not null
user_id text not null
access_role text not null check in
  ('hr_admin','payroll_specialist','payroll_approver','sensitive_hr','hr_auditor')
unique (organization_id, legal_entity_id, user_id, access_role)
```

Role expansion is fixed:

| Assignment           | Capabilities                           |
| -------------------- | -------------------------------------- |
| `hr_admin`           | `readHr`, `manageHr`                   |
| `payroll_specialist` | `readPayroll`, `managePayroll`         |
| `payroll_approver`   | `readPayroll`, `approvePayroll`        |
| `sensitive_hr`       | `readSensitiveHr`, `manageSensitiveHr` |
| `hr_auditor`         | `readHr`, `readPayroll`                |

Only organization owners may create or revoke assignments. An assignment is
valid only for its legal entity. API scope is the intersection of membership
entity scope and assigned entity IDs. Owners keep all-entity scope. An admin's
existing operational HR access remains, but Wave 2 intentionally removes payroll
screens from admins who have no payroll assignment.

Static base capabilities remain in `@bap/security`. The application API access
resolver loads assignments and ORs their expansion into the application access
response; the reporting API does not load HR assignments. This keeps database
access out of the security package. Resource-token authorization uses the
resolved application response and still intersects the membership entity scope.

Self-service does not add organization capabilities. `GET /my-hr/access`
resolves one active `employee_user_binding` and returns
`{ available, employeeId, legalEntityId }`, with IDs omitted when unavailable.
Every own-record repository derives its employee ID from that resolved binding.
A binding never grants a collection endpoint or another employee ID.

## State-transition contracts

### Employee lifecycle

```text
preboarding -> active -> inactive -> archived
preboarding -> cancelled
inactive -> active requires reason
archived and cancelled are terminal
```

Every transition inserts `employee_status_change`; it does not rewrite history.
Wave 1 expands `employee.status` to the 5 values above, changes the create
default to `preboarding`, and keeps all migrated Wave 0 employees at their
existing `active` or `inactive` status.

### Checklist

```text
pending -> in_progress -> completed
pending|in_progress -> skipped, with reason
completed|skipped are terminal
```

### Employee document approval

```text
not_required is terminal for a category that needs no approval
pending -> approved|rejected
approved|rejected are terminal; a replacement is a superseding document link
```

### Timesheet

```text
draft -> submitted -> approved
submitted -> draft, with rejection reason
approved -> corrected, then a new draft version is inserted
```

### Leave request

```text
requested -> approved|rejected|cancelled
approved -> taken|cancelled
taken|rejected|cancelled are terminal
```

### Payroll run

```text
draft -> validating -> ready_for_approval -> approved -> finalized -> paid
validating -> draft, with validation issues
ready_for_approval -> draft, with rejection reason
finalized -> superseded only by finalizing a higher linked version
paid -> superseded only by finalizing a higher linked version
```

Only `managePayroll` starts validation or returns a run to draft. Only
`approvePayroll` approves. The approving actor cannot finalize the same run when
another eligible payroll user exists. `managePayroll` finalizes and records
payment. Finalization is the only action that creates the payroll document and
economic event.

### Deferred extension: statutory submission

```text
draft -> validated -> exported -> submitted -> accepted|rejected
rejected -> corrected, then a new version is inserted
```

No transition contacts an authority in Wave 6. `submitted`, `accepted`, and
`rejected` are recorded from a manual receipt.

## Schema catalog

The common columns and policies above apply to every entry.

### Wave 0 tables

The existing migration keeps `employee`, `employment_relationship`,
`employee_document`, `payroll_run`, and `payroll_result`. Wave 0 corrects their
constraints and permissions only. It does not add later-wave columns.

### Wave 1: employee lifecycle

Wave 1 replaces `employee_status_check` with the 5-state lifecycle check and
changes the database/API create default to `preboarding`.

```text
hr_department:
  legal_entity_id, code varchar(64), name varchar(200), parent_id uuid null,
  active boolean default true; unique (legal_entity_id, code)

hr_position:
  legal_entity_id, code varchar(64), name varchar(200), active boolean default true;
  unique (legal_entity_id, code)

hr_cost_centre:
  legal_entity_id, code varchar(64), name varchar(200), active boolean default true;
  unique (legal_entity_id, code)

hr_workplace:
  legal_entity_id, code varchar(64), name varchar(200), address_label varchar(300) null,
  active boolean default true; unique (legal_entity_id, code)

employment_term:
  employee_id, relationship_id, version integer >= 1,
  supersedes_employment_term_id uuid null, effective_from date,
  effective_to date null, position_id uuid null, department_id uuid null,
  cost_centre_id uuid null, workplace_id uuid null, manager_employee_id uuid null,
  weekly_hours numeric(7,2) > 0 and <= 168, working_time_pattern varchar(64),
  unique (relationship_id, version), at most one direct successor per superseded term

employee_status_change:
  employee_id, from_status text null, to_status text,
  effective_at timestamptz, reason varchar(500) null

hr_document_category:
  legal_entity_id, code varchar(64), name varchar(200),
  confidentiality text in ('operational','payroll','restricted'),
  retention_key varchar(64), requires_approval boolean default false,
  active boolean default true; unique (legal_entity_id, code)

employee_document additions:
  category_id uuid null, relationship_id uuid null,
  approval_status text in ('not_required','pending','approved','rejected'),
  approved_by text null, approved_at timestamptz null,
  supersedes_document_id uuid null

hr_checklist_template:
  legal_entity_id, kind text in ('onboarding','change','offboarding'),
  code varchar(64), name varchar(200), active boolean default true;
  unique (legal_entity_id, code)

hr_checklist_template_item:
  template_id, position integer >= 1, title varchar(200),
  default_due_offset_days integer, document_category_id uuid null,
  active boolean default true;
  unique (template_id, position)

hr_checklist:
  legal_entity_id, employee_id, relationship_id uuid null, template_id,
  kind, status text in ('open','completed','cancelled'), started_on date,
  completed_at timestamptz null

hr_checklist_task:
  checklist_id, template_item_id uuid null, title varchar(200), owner_user_id text,
  due_on date, document_category_id uuid null,
  status text in ('pending','in_progress','completed','skipped'),
  skip_reason varchar(500) null, document_id uuid null,
  completed_by text null, completed_at timestamptz null
```

Wave 1 backfills one `employment_term` per existing relationship from its
position, department, cost-centre, weekly-hours, and dates. `effective_from` is
the relationship start date and `effective_to` is its nullable end date.
Existing columns stay read-only compatibility columns until Wave 1 is fully
deployed. All new reads use `employment_term`.

Employment terms are append-only. A correction inserts a higher version whose
`supersedes_employment_term_id` points to an earlier version of the same
relationship; a term can have at most one direct successor. An open-ended prior
version keeps its original nullable `effective_to`. For an effective date,
current-term resolution keeps rows whose effective range contains the date,
ignores a row once its direct successor is effective, and orders by
`effective_from DESC, version DESC, id` to return one row. This preserves a
prior version before its successor takes effect without requiring an update to
close that prior version.

### Wave 2: payroll workflow

```text
hr_access_assignment: columns and constraints defined in Permission contract

payroll_run additions:
  document_id becomes nullable while status is draft through approved;
  finalized, paid, and superseded require document_id not null;
  status text using payroll state machine, origin text in ('imported','calculated'),
  idempotency_key uuid, validation_summary jsonb default '{}',
  approved_by text null, approved_at timestamptz null,
  finalized_by text null, finalized_at timestamptz null,
  paid_by text null, paid_at timestamptz null, payment_reference varchar(200) null,
  rule_set_id uuid null; unique (organization_id, idempotency_key)

payroll_component_definition:
  legal_entity_id, code varchar(64), name varchar(200),
  kind text in ('earning','deduction','employer_contribution'),
  recurrence text in ('recurring','one_off'), accounting_key varchar(64),
  active boolean default true; unique (legal_entity_id, code)

employee_compensation_component:
  employee_id, relationship_id, component_definition_id,
  valid_from date, valid_to date null, amount numeric(19,4), currency char(3)='CZK',
  unique (relationship_id, component_definition_id, valid_from)

payroll_result_component:
  payroll_result_id, component_definition_id, amount numeric(19,4),
  source text in ('imported','calculated','adjustment'), description varchar(200) null

payroll_liability:
  payroll_run_id, kind text in ('net_wages','social','health','income_tax','other'),
  creditor_reference varchar(200) null, amount numeric(19,4), due_on date,
  status text in ('open','paid'), paid_at timestamptz null;
  unique (payroll_run_id, kind, creditor_reference)

payroll_approval:
  payroll_run_id, action text in ('submitted','approved','rejected','finalized','paid'),
  actor_user_id text, reason varchar(500) null, acted_at timestamptz;
  append only

payroll_account_mapping:
  legal_entity_id, accounting_key varchar(64), account_code varchar(16),
  side text in ('debit','credit'), valid_from date, valid_to date null;
  unique (legal_entity_id, accounting_key, valid_from)

payroll_result_document:
  payroll_result_id, document_id, kind text in ('payslip','supporting');
  unique (payroll_result_id, document_id)

payroll_import:
  legal_entity_id, source_document_id uuid, idempotency_key uuid,
  payroll_month date, payroll_run_id uuid null,
  format text in ('csv','xlsx'), status text in ('staged','validated','failed','consumed'),
  row_count integer >= 0, error_count integer >= 0,
  error_report jsonb default '[]'; unique (organization_id, idempotency_key)
```

W2.4 adds `payroll_month` and nullable `payroll_run_id` to `payroll_import` in a
new forward migration. `payroll_month` is the first day of its month.
`payroll_run_id` is unique, belongs to the same organization and legal entity,
and is null unless status is `consumed`; a consumed import must have it. This
link is the authoritative idempotent replay result for `consume`.

Wave 2 backfills existing payroll runs as `status='finalized'`,
`origin='imported'`, `finalized_by=created_by`, and `finalized_at=created_at`.
It does not recreate documents or economic events. After deployment,
`POST /payroll-runs` creates only a draft. Import-and-finalize compatibility is
not retained.

`bap_api` receives column-level payroll-run `UPDATE` only for `status`,
`validation_summary`, `document_id`, approval/finalization/payment actor and
timestamp fields, and `payment_reference`. It receives no update/delete grant on
payroll results or core run identity/month/version/origin fields. A database
trigger rejects a workflow transition not listed in the payroll state table.

PATCH of an employee compensation component or payroll account mapping closes
the current version on the day before the supplied new `validFrom` and inserts a
new version. It never updates an amount/account in place. PATCH of a payroll
component definition may change only `name` and `active`; code, kind,
recurrence, and accounting key are immutable.

### Wave 3: time, leave, and absence

```text
work_schedule:
  legal_entity_id, employee_id, relationship_id, version integer >= 1,
  period_start date, period_end date, status text in ('draft','published','superseded');
  unique (relationship_id, period_start, version)

work_shift:
  schedule_id, starts_at timestamptz, ends_at timestamptz,
  break_minutes integer >= 0, kind text in ('regular','on_call')

timesheet:
  legal_entity_id, employee_id, relationship_id, period_start date,
  period_end date, version integer >= 1, status using timesheet state machine,
  submitted_at timestamptz null, approved_by text null, approved_at timestamptz null,
  supersedes_timesheet_id uuid null; unique (relationship_id, period_start, version)

time_entry:
  timesheet_id, work_date date, started_at timestamptz, ended_at timestamptz,
  break_minutes integer >= 0, overtime_minutes integer >= 0,
  night_minutes integer >= 0, holiday_minutes integer >= 0,
  standby_minutes integer >= 0, activity_code varchar(64) null

leave_type:
  legal_entity_id, code varchar(64), name varchar(200),
  unit text in ('hours','days'), paid boolean, active boolean default true;
  unique (legal_entity_id, code)

leave_request:
  legal_entity_id, employee_id, relationship_id, leave_type_id,
  starts_on date, ends_on date, requested_amount numeric(7,2),
  status using leave state machine, decided_by text null,
  decided_at timestamptz null, reason varchar(500) null

leave_ledger:
  legal_entity_id, employee_id, relationship_id, leave_type_id,
  effective_on date, amount numeric(7,2),
  source text in ('opening','entitlement','request','correction','expiry'),
  source_id uuid null; append only

absence:
  legal_entity_id, employee_id, relationship_id,
  kind text in ('sickness','care','parental','unpaid','other'),
  starts_on date, ends_on date null, payroll_code varchar(64),
  document_id uuid null; no diagnosis or free-text medical detail
```

### Wave 4: employee self-service

Migration: `packages/db/drizzle/20260921.0008_hr_self_service.sql`.

```text
employee_user_binding:
  legal_entity_id, employee_id unique, user_id text,
  status text in ('pending','active','revoked'), verified_at timestamptz null;
  unique (organization_id, user_id)
```

Only an owner creates a pending binding. The named user activates it through a
verified session. Every `/my-hr` query derives both organization and employee
from one active binding. It exposes operational employee fields, registered
documents, finalized payslips, and own time and leave only. It neither writes
nor exposes private, bank, tax, dependant, or medical values.

### Wave 5: notifications and deadlines

Migration: `packages/db/drizzle/20260924.0001_hr_notifications.sql`.

```text
hr_outbox:
  legal_entity_id, event_type varchar(100), resource_type varchar(100),
  resource_id uuid, recipient_user_id text null, dedupe_key varchar(200),
  payload jsonb, available_at timestamptz, processed_at timestamptz null,
  attempts integer default 0 check attempts >= 0;
  unique (organization_id, event_type, dedupe_key);
  payload contains identifiers and event names only

hr_notification:
  legal_entity_id, user_id text, outbox_id uuid, kind varchar(100),
  resource_type varchar(100), resource_id uuid, read_at timestamptz null,
  created_at timestamptz; unique (user_id, outbox_id)
```

Only in-app notifications exist. Producers cover checklist due/overdue,
relationship ending, payroll liability, timesheet submitted/approved/rejected,
leave submitted/decided/cancelled, payroll state, and payslip availability. The
daily scan emits checklist events on the due day and once on the next day if
still overdue; relationship-ending events 30 and 7 calendar days before the end
date; and liability events 7 days before, on the due day, and once on the next
day if still open. A deadline dedupe key is
`<eventType>:<resourceId>:<triggerDate>`. Retries are bounded and re-check
active membership or binding before delivery.

Recipient resolution is fixed:

- checklist due/overdue goes to the task owner;
- relationship ending goes to current users with `manageHr` in the legal entity;
- an open payroll liability goes to current users with `managePayroll` in the
  legal entity;
- timesheet or leave submission/cancellation goes to current `manageHr` users;
- timesheet approval/rejection and leave decision goes to the active bound
  employee, when one exists;
- payroll approval-state events go to current `managePayroll` or
  `approvePayroll` users as applicable to the next action;
- payslip availability goes to the active bound employee.

Direct-recipient events store `recipient_user_id`; role-targeted events leave it
null and resolve the current recipients at delivery. No event is delivered to a
revoked binding, former member, or user whose entity assignment no longer
authorizes it.

### Wave 6: supplied-input payroll calculation

Migration: `packages/db/drizzle/20260924.0002_payroll_supplied_calculation.sql`.

```text
payroll_supplied_input_snapshot:
  payroll_run_id, employee_id, calculator_version varchar(64), input jsonb,
  input_checksum char(64), created_by text, created_at timestamptz;
  unique (payroll_run_id, employee_id); append only
```

Input JSON is strict and canonical. A money value is a non-negative decimal
string with at most 4 fractional digits. A percentage rate is a decimal string
from 0 through 100 with at most 6 fractional digits. A rounding instruction is
`{ unit: '0.01'|'1.00', mode: 'half_up'|'up'|'down' }`. A rate line is
`{ base, ratePercent, rounding }`, and its amount is
`round(base * ratePercent / 100, rounding)`.

Each employee input is exactly
`{ employeeId, grossPay, employeeSocial, employeeHealth, employerSocial, employerHealth, taxLines, taxCredits, otherDeductions }`,
where the 4 contribution fields are rate lines and `taxLines` contains 1 through
4 rate lines. One request contains 1 through 1,000 employees with no duplicate
employee ID. Tax is `max(0, sum(each rounded tax-line amount) - taxCredits)`.
Net pay is gross pay less the 2 employee contribution amounts, tax, and other
deductions; a negative result is rejected. Employer cost is gross pay plus the 2
employer contribution amounts. Each final money value has at most 4 decimal
places.

The pure calculator uses scaled integers only and never infers a legal rate,
base, eligibility, cap, credit, or tax treatment. The canonical snapshot stores
the complete validated input, SHA-256 checksum, calculator version, and actor.
Runs use the existing `calculated` origin and are labelled
`calculated from supplied parameters`. Tax bonuses, net-positive adjustments,
sickness calculation, annual reconciliation, and other unsupported cases use
import/manual.

### Wave 7: analytics and operational closure

Analytics are SQL queries over authoritative tables, not new editable facts. One
page presents headcount/FTE and time/absence panels only with `readHr`, and
payroll cost/liabilities and accounting reconciliation panels only with
`readPayroll`. The API enforces each capability independently, the page hides an
unauthorized panel, and legal-entity scope always applies. No blanket group-size
suppression is added.

## API contract

All paths are below `/v1/organizations/:organizationId`. Every identifier is a
UUID except Better Auth user IDs. Unless an endpoint-specific shape below says
otherwise, new collection responses are `{ items, page, pageSize, total }`, with
`page` default 1 and `pageSize` default 25, maximum 100. The Wave 0
compatibility responses remain `{ employees, page, pageSize, total }` and
`{ payrollRuns, page, pageSize, total }`. Default ordering is the first order
listed plus `id ASC` as the stable tie-breaker. Invalid input is 400,
duplicate/idempotency conflict is 409, denied capability is 403, and
invisible/cross-entity resource is 404.

Resource creation returns 201, GET/PATCH/PUT and state commands return 200, and
DELETE returns 204 with no body. Replaying the same idempotency key and
identical request returns the original status/body; reusing the key with a
different request returns 409.

### Wave 0 endpoints

Existing employee and payroll endpoints stay as documented in
`docs/hr-payroll.md`. Query contracts are fixed:

```text
GET /employees: legalEntityId?, q?, status?, page?, pageSize?;
  order last_name, first_name, id
GET /payroll-runs: legalEntityId?, month?, page?, pageSize?;
  order payroll_month desc, version desc, id
```

`PATCH /employees/:id` cannot change `employeeNumber` or `legalEntityId`.
Payroll amounts are non-negative decimal strings on both API and web.

### Wave 1 endpoints

```text
GET|POST /hr/departments
PATCH /hr/departments/:id
GET|POST /hr/positions
PATCH /hr/positions/:id
GET|POST /hr/cost-centres
PATCH /hr/cost-centres/:id
GET|POST /hr/workplaces
PATCH /hr/workplaces/:id
POST /employees/:id/status-transitions
GET /employees/:id/status-history
GET|POST /employees/:id/employment-terms
GET|POST /hr/document-categories
PATCH /hr/document-categories/:id
PATCH /employees/:id/documents/:documentId
GET|POST /hr/checklist-templates
PATCH /hr/checklist-templates/:id
POST /hr/checklist-templates/:id/items
PATCH /hr/checklist-templates/:id/items/:itemId
GET|POST /employees/:id/checklists
PATCH /employees/:id/checklists/:checklistId/tasks/:taskId
```

Reference-data list/create/update uses `readHr`/`manageHr`. Status and term
writes use `manageHr`. No delete endpoint exists; `active=false` retires
reference data.

Wave 1 reference-data HTTP shapes are fixed:

```text
list query: legalEntityId? uuid, q? trimmed 1..100, active? boolean,
  page default 1, pageSize default 25 max 100
list response: the endpoint's plural key plus page, pageSize, total
common item: id, legalEntityId, code, name, active, createdAt, updatedAt
common create: legalEntityId, code trimmed 1..64, name trimmed 1..200
common patch: name? and active?; at least one field; code and legalEntityId immutable
department item: parentId uuid|null; create parentId? defaults null;
  patch may set parentId uuid|null
workplace item: addressLabel trimmed 1..300|null;
  create addressLabel? defaults null; patch may set it null
document-category item/create: retentionKey trimmed 1..64,
  requiresApproval boolean, confidentiality literal operational
document-category patch: name?, retentionKey?, requiresApproval?, active?;
  confidentiality and code immutable
```

The plural response keys are `departments`, `positions`, `costCentres`,
`workplaces`, and `documentCategories`. Search covers code and name with escaped
`ILIKE` wildcards. Sort is `code ASC, id ASC`. POST returns the created item
with 201; PATCH returns the updated item with 200. Duplicate entity/code is 409.
An invisible legal entity, parent, or item is 404. Unknown query or body keys
are 400. Wave 1 rejects document-category confidentiality other than
`operational` at validation before repository execution.

Wave 1 employment-term HTTP shapes are fixed:

```text
GET query: relationshipId? uuid, effectiveOn? date,
  page default 1, pageSize default 25 max 100
GET response: items, page, pageSize, total
item: id, employeeId, relationshipId, version,
  supersedesEmploymentTermId uuid|null, effectiveFrom date,
  effectiveTo date|null, positionId uuid|null, departmentId uuid|null,
  costCentreId uuid|null, workplaceId uuid|null,
  managerEmployeeId uuid|null, weeklyHours decimal string,
  workingTimePattern trimmed 1..64, createdAt
POST body: every item field from relationshipId through workingTimePattern;
  supersedesEmploymentTermId? defaults null; IDs, version, actor, and timestamps
  are server-derived
```

Without `effectiveOn`, GET returns immutable history in
`effectiveFrom DESC, version DESC, id ASC` order. With `effectiveOn`, it returns
at most one current term per matching relationship using the current-term rule
in the schema catalog, with the same stable order and paging. A root POST uses
version 1 and is permitted only when that relationship has no term. A correction
must name the term it supersedes, must use the same relationship, and receives
`predecessor.version + 1`; its body is a complete replacement snapshot, not a
partial patch. `effectiveTo` cannot precede `effectiveFrom`. An invisible
employee, relationship, reference row, or manager is 404. A second root,
branching successor, duplicate version, or overlapping unsuperseded root is 409.
Each POST and its identifier-only audit row share one tenant transaction.

Wave 1 employee-lifecycle HTTP shapes are fixed:

```text
POST status-transition body: toStatus, effectiveAt ISO date-time, reason?
POST response: id, employeeId, fromStatus, toStatus, effectiveAt,
  reason, createdAt
GET status-history query: page default 1, pageSize default 25 max 100
GET status-history response: items, page, pageSize, total
history item: the POST response shape
```

Status history orders by `effectiveAt DESC, createdAt DESC, id ASC`. The POST is
a command and returns 200. It locks the visible employee, validates the current
database status and exact state edge, inserts history, updates the employee, and
records an identifier-only audit in one tenant transaction. Concurrent commands
from the same prior state have one winner; the loser is 409. A forbidden edge is
409, an invisible employee is 404, and a missing required reason is 400. In Wave
1, `inactive -> active` is the only manual override and requires a trimmed
reason of 1..500 characters; automatic status derivation is not implemented.
Employee creation accepts no status field and always creates `preboarding`.
`PATCH /employees/:id` no longer accepts status; every later status change uses
the command endpoint.

Wave 1 employee-document HTTP shapes are fixed:

```text
GET query: categoryId? uuid, approvalStatus?, currentOnly default true,
  page default 1, pageSize default 25 max 100
GET response: items, page, pageSize, total
item: documentId, title, documentDate, categoryId uuid|null,
  relationshipId uuid|null, approvalStatus, approvedBy string|null,
  approvedAt date-time|null, supersedesDocumentId uuid|null, createdAt
POST body: documentId, categoryId, relationshipId? uuid|null defaults null,
  supersedesDocumentId? uuid|null defaults null
PATCH body: categoryId?, relationshipId? uuid|null,
  supersedesDocumentId? uuid|null, approvalDecision? approved|rejected;
  at least one field
```

GET orders by linked `createdAt DESC, documentId ASC`. `currentOnly=true`
excludes a row once another visible link supersedes it. In Wave 1, list and
mutation accept only an `operational` category; a payroll or restricted category
or link is treated as invisible. An uncategorized migrated Wave 0 link remains
visible until categorized. Setting a category derives `pending` when approval is
required and `not_required` otherwise, and clears prior approval actor/time.
`approvalDecision` is valid only from `pending` and sets actor/time. A
relationship must belong to the same employee. A superseded document must be a
different link for the same employee and category. A link has at most one direct
successor, and no supersession cycle is allowed. Invisible employee, document,
category, relationship, or predecessor is 404; duplicate link, invalid approval
transition, branching successor, or cycle is 409. POST returns the full item
with 201; PATCH returns it with 200. Each mutation and identifier-only audit row
share one tenant transaction.

Wave 1 checklist HTTP shapes are fixed:

```text
GET /hr/checklist-templates query: legalEntityId? uuid, kind?, active? boolean,
  q? trimmed 1..100, page default 1, pageSize default 25 max 100
GET response: items, page, pageSize, total
template item: id, legalEntityId, kind, code, name, active, createdAt,
  updatedAt, items[]
template child: id, templateId, position, title, defaultDueOffsetDays,
  documentCategoryId uuid|null, active, createdAt, updatedAt
POST /hr/checklist-templates body: legalEntityId, kind, code, name
PATCH /hr/checklist-templates/:id body: name?, active?; at least one field
POST /hr/checklist-templates/:id/items body: position, title,
  defaultDueOffsetDays, documentCategoryId? uuid|null defaults null
PATCH /hr/checklist-templates/:id/items/:itemId body: position?, title?,
  defaultDueOffsetDays?, documentCategoryId? uuid|null, active?;
  at least one field

GET /employees/:id/checklists query: kind?, status? open|completed|cancelled,
  ownerUserId? trimmed 1..200, dueBefore? date, page default 1,
  pageSize default 25 max 100
GET response: items, page, pageSize, total
checklist item: id, legalEntityId, employeeId, relationshipId uuid|null,
  templateId, kind, status, startedOn, completedAt date-time|null,
  createdAt, updatedAt, tasks[]
task item: id, checklistId, templateItemId uuid|null, title, ownerUserId,
  dueOn, documentCategoryId uuid|null, status, skipReason string|null,
  documentId uuid|null, completedBy string|null, completedAt date-time|null,
  createdAt, updatedAt
POST /employees/:id/checklists body: templateId,
  relationshipId? uuid|null defaults null, startedOn date, ownerUserId
PATCH /employees/:id/checklists/:checklistId/tasks/:taskId body:
  status in_progress|completed|skipped, skipReason?, documentId? uuid|null
```

Template lists order by `code ASC, id ASC`; child items order by
`position ASC, id ASC`. Template codes, legal entity and kind are immutable.
Template updates are name/retire only. Child positions are unique per template;
`defaultDueOffsetDays` is an integer from -3,650 through 3,650. A referenced
document category must be operational and belong to the template legal entity.
Invisible templates, child items or categories are 404; duplicate code or
position is 409. Template and item writes use `manageHr`, reads use `readHr`,
and each write records an identifier-only audit in the same transaction.

Checklist creation locks and validates a visible active template for the
employee legal entity, an optional relationship for that employee, and at least
one active template item. It creates an `open` checklist and one `pending` task
per active item in one transaction. Every task copies the template item ID,
title and document category; `dueOn` is `startedOn + defaultDueOffsetDays` and
the request `ownerUserId` owns every created task. Later template edits never
rewrite an instance. Checklist list filters apply to checklist kind/status and
include a checklist for `ownerUserId` or `dueBefore` when any task matches.
Checklists order by their earliest task due date ascending, nulls last, then
checklist ID; included tasks order by `dueOn ASC, id ASC`.

Task commands lock the visible task and enforce
`pending -> in_progress -> completed` or `pending|in_progress -> skipped`.
Completed and skipped are terminal. `skipReason` is required and trimmed to
1..500 only for skipped, and is rejected otherwise. A linked document must be a
current operational employee-document link for the same employee and, when the
task snapshots a category, that category must match. Completing a categorized
task requires a matching linked document; skipping does not. Completed or
skipped sets actor and timestamp. When every task is terminal, the checklist
becomes `completed` with `completedAt` in the same transaction. Wave 1 exposes
no checklist cancel command. Invisible employee, checklist, task or document is
404; forbidden or terminal transitions are 409. Checklist creation and task
commands use `manageHr`; list uses `readHr`; mutations and identifier-only
audits share one transaction.

### Wave 2 endpoints

```text
GET|POST /hr/access-assignments
DELETE /hr/access-assignments/:assignmentId
GET|POST /payroll/components
PATCH /payroll/components/:id
GET|POST /employees/:id/compensation-components
PATCH /employees/:id/compensation-components/:componentId
POST /payroll/imports
GET /payroll/imports/:id
POST /payroll/imports/:id/consume
POST /payroll-runs
POST /payroll-runs/:id/validate
POST /payroll-runs/:id/submit-for-approval
POST /payroll-runs/:id/approve
POST /payroll-runs/:id/reject
POST /payroll-runs/:id/finalize
POST /payroll-runs/:id/record-payment
POST /payroll-runs/:id/corrections
GET /payroll-runs/:id/approvals
GET /payroll-runs/:id/liabilities
GET /employees/:id/payroll-results
GET|POST /payroll/account-mappings
PATCH /payroll/account-mappings/:id
```

Imports accept multipart CSV/XLSX up to 5 MB, stage through the existing upload
boundary, and enqueue identifiers only. Validation returns row numbers and field
codes, never names or amounts in logs. `consume` is all-or-nothing and creates a
draft run.

The W2.4 import contract is exact:

- `POST /payroll/imports` takes an `Idempotency-Key` UUID header and multipart
  fields `file`, `legalEntityId`, and `payrollMonth`. `payrollMonth` is
  `YYYY-MM-01`. The file is non-empty, at most 5,000,000 bytes, and its filename
  extension is `.csv` or `.xlsx`; the existing content-signature checks still
  apply. The response is HTTP 201 `{ "payrollImport": <import> }`.
- The API stages the bytes under a server-generated UUID, creates the matching
  `app.upload`, a `kind='payroll'`, `source='upload'` document linked to that
  upload, and the `payroll_import` row in one tenant transaction, then enqueues
  `{ organizationId, payrollImportId, userId }`. No filename, path, month,
  employee identifier, or amount enters the queue payload. A replay of the same
  organization/idempotency key returns the original import and enqueues no
  second job.
- The worker re-resolves current membership, `managePayroll`, assignment-derived
  legal-entity scope, and the import's entity before opening its write
  transaction. Revocation or scope removal fails before mutation. It retains the
  staged file only while the import is `staged` or `validated`; terminal failure
  and successful consume remove it. A retry of a staged validation is safe and
  replaces no facts.
- CSV uses UTF-8 and a header row. XLSX uses the first worksheet and its first
  non-empty row as the header. The 10 required, case-sensitive columns are
  `employeeNumber`, `grossPay`, `employeeSocial`, `employeeHealth`, `incomeTax`,
  `otherDeductions`, `netPay`, `employerSocial`, `employerHealth`, and
  `employerCost`. Extra result-component columns use
  `component:<componentCode>`. No other, empty, or duplicate header is valid.
- Each non-empty data row names one employee by `employeeNumber`. Employees are
  resolved only inside the import legal entity. Unknown and other-entity numbers
  use the same `employee_not_found` code. An employee may occur only once.
  Amounts are non-negative decimal values with at most 4 fractional digits and
  must satisfy the database net-pay and employer-cost arithmetic. A blank
  component cell creates no component; a populated component column must resolve
  to one active same-entity definition and creates an imported result component.
- Validation reads at most 10,001 data rows so row 10,001 deterministically
  produces `row_limit_exceeded`. It records the total observed error count and
  retains only the first 1,000 entries ordered by row then field. Each entry is
  exactly `{ row, field, code }`; permitted codes are `malformed_file`,
  `invalid_header`, `row_limit_exceeded`, `required`, `invalid_employee_number`,
  `employee_not_found`, `duplicate_employee`, `invalid_amount`,
  `arithmetic_mismatch`, and `component_not_found`. It stores no submitted
  value. Zero errors sets `validated`; any error sets `failed`.
- `GET /payroll/imports/:id` requires `readPayroll` and returns
  `{ "payrollImport": <import> }`; an invisible import is 404. The import shape
  is exactly `id`, `legalEntityId`, `sourceDocumentId`, `payrollMonth`,
  `format`, `status`, `rowCount`, `errorCount`, `errorReport`, `payrollRunId`,
  and `createdAt`.
- `POST /payroll/imports/:id/consume` requires `managePayroll`, accepts no body,
  and is idempotent by import ID. A validated import creates one
  `origin='imported'`, `status='draft'` payroll run, all payroll results and
  populated result components, sets `payroll_run_id` and `consumed`, and writes
  identifier-only audits in one tenant transaction. Any validation drift,
  missing staged file, duplicate month/version conflict, or insert failure rolls
  back every created fact and leaves the import `validated`. A replay of a
  consumed import returns HTTP 200
  `{ "payrollRunId": <uuid>, "status": "draft" }`; the first consume returns
  HTTP 201 with the same shape. A staged import conflicts; a failed import
  rejects as unprocessable.

`Idempotency-Key` is required on creation and on the payroll-run command
endpoints introduced by W2.5. Import consume uses its persisted import-to-run
link instead of accepting a second key.

The W2.5 command contract is exact:

- A forward migration adds `payroll_command_receipt` with `organization_id`,
  `payroll_run_id`, `command`, `idempotency_key`, `request_hash`, nullable
  `result_payroll_run_id`, `reason`, `created_by`, and `created_at`. Commands
  are `validate`, `submit`, `approve`, `reject`, `finalize`, `record_payment`,
  and `correct`. `(organization_id, idempotency_key)` is unique. Rows are tenant
  isolated, append-only through `bap_api`, readable by reporting/backup, and
  their actor participates in user erasure. A replay returns the persisted
  result only when run, command, and SHA-256 request hash all match; otherwise
  it is 409. Each command serializes its key before checking/inserting the
  receipt.
- The migration adds an owner-defined, security-definer boolean function that
  answers only whether another currently verified user can `managePayroll` for
  one organization/entity. Eligible users are organization owners and current
  members with a same-entity `payroll_specialist` assignment intersected with
  their stored entity scope. `bap_api` may execute the function but receives no
  auth-table read grant.
- Payroll account mappings used for finalization have exactly a 3-digit shared
  directive account and the expected side. The migration enforces the account
  shape/reference. The 6 accounting keys and defaults are `gross_pay/debit/521`,
  `employer_contributions/debit/524`, `net_wages/credit/331`,
  `insurance_payable/credit/336`, `income_tax/credit/342`, and
  `other_deductions/credit/333`. The effective mapping with the greatest
  `validFrom` containing the payroll month overrides its default. A wrong-side
  or non-resolvable mapping is a validation issue.
- The payroll API, not the legacy HR controller, owns list, detail, creation,
  and every command. Reads require `readPayroll`; creation, validation,
  submission, rejection, finalization, correction and payment require
  `managePayroll`; approval requires `approvePayroll`. The existing
  `/payroll-runs` URLs remain fixed, but no route retains `readHr`/`manageHr`.
- A payroll-run response is strict and contains `id`, `legalEntityId`, nullable
  `documentId`, `month` (`YYYY-MM`), `version`, nullable
  `supersedesPayrollRunId`, `status`, `origin`, `validationSummary`, nullable
  approval/finalization/payment actors and timestamps, nullable
  `paymentReference`, nullable `ruleSetId`, `createdAt`, and `results` using the
  existing recorded-result shape. `validationSummary` is exactly
  `{ valid, issues }`; each issue is `{ code, count }`. Codes are
  `missing_results`, `invalid_account_mapping`, and `unbalanced_accounting`.
- `POST /payroll-runs` takes the existing strict legal-entity, month and
  1..1,000 recorded-result body plus `Idempotency-Key`. It accepts neither
  version nor predecessor. It creates only version 1, `origin='calculated'`,
  `status='draft'`, immutable results and an identifier-only audit in one
  transaction. It creates no document, event, liability, approval or result
  document. Same-key replay returns the same run; a different request with that
  key is 409.
- `validate` is synchronous. From `draft`, it moves through `validating` in one
  transaction and computes the exact validation summary from recorded facts and
  effective account mappings. Issues return it to `draft`; no issues leave it
  `validating` with `valid=true`. It creates no approval row. A replay returns
  the same state and summary without repeating mutations.
- `submit-for-approval` accepts only a `validating` run with
  `validationSummary.valid=true`, moves it to `ready_for_approval`, and appends
  `submitted`. `approve` accepts only `ready_for_approval`, moves it to
  `approved`, sets approval actor/time, and appends `approved`. `reject` accepts
  only `ready_for_approval`, requires a trimmed 1..500 reason, moves it to
  `draft`, keeps the last validation summary, and appends `rejected`.
- `finalize` accepts only `approved`, takes the transaction-level advisory lock
  on entity/month, and rechecks the valid summary. When the approving actor is
  the finalizer and the security-definer function reports another eligible
  manager, it returns 409. In one transaction it creates the header payroll
  document, one non-identifying payroll register document per result linked as
  `kind='payslip'`, the 6 mapped non-zero economic-event lines, open non-zero
  liabilities, `finalized` approval, actor/time, and the finalized state. The
  event rule-set version is `hr-payroll-recorded-facts-1`; debit and credit must
  both equal employer cost or the transaction fails. Result-document titles are
  `Payroll result`, with no employee name, number, amount, or reference.
- Liability formulas are `net_wages=netPay`,
  `social=employeeSocial+employerSocial`,
  `health=employeeHealth+employerHealth`, `income_tax=incomeTax`, and
  `other=otherDeductions`, aggregated over results. Zero liabilities are
  omitted. `dueOn` is the final calendar day of the payroll month and is an
  internal settlement target, not a statutory filing deadline. Creditor
  reference is null until a later explicit workflow supplies one.
- `record-payment` accepts only `finalized`, a real ISO instant `paidAt`, and a
  trimmed 1..200 `paymentReference`. It moves the run and every open liability
  to paid using that instant, sets the payment actor/reference, and appends
  `paid`. It records confirmation only and initiates no payment.
- `corrections` accepts only `finalized` or `paid`, a trimmed 1..500 reason, and
  the entity/month advisory lock. It inserts the next version as a linked draft
  with the source origin, copies results and result components, and creates no
  document/event/liability/result document. The source remains unchanged until
  the correction is finalized. Finalizing the correction supersedes its direct
  predecessor in the same transaction; no older fact is edited otherwise.
- Approvals return `{ approvals: [...] }` ordered by `actedAt,id`; liabilities
  return `{ liabilities: [...] }` ordered by `kind,creditorReference,id`.
  Approval rows expose action, nullable reason, actor and actedAt. Liability
  rows expose kind, nullable creditorReference, amount, dueOn, status and
  nullable paidAt. Invisible runs are 404; illegal state, actor separation,
  reused-key mismatch and concurrent losers are 409. Audits and exceptions
  contain identifiers/codes only, never amounts, payment references or reasons.

The W2.6 employee payroll-history and browser contract is exact:

- `GET /employees/:id/payroll-results` requires `readPayroll`. An invisible
  employee or an employee outside the effective payroll entity scope is 404.
  Query parameters are optional `fromMonth` and `toMonth` in `YYYY-MM`, plus
  `page` default 1 and `pageSize` default 25, maximum 100. `fromMonth` after
  `toMonth` is 400. No other query parameter is accepted.
- The response is `{ payrollResults, page, pageSize, total }`. Each strict item
  contains `payrollRunId`, `legalEntityId`, `month`, `version`,
  `supersedesPayrollRunId`, `status`, `origin`, the 10 recorded monetary result
  fields, nullable `payslipDocumentId`, nullable `finalizedAt`, and nullable
  `paidAt`. It includes every visible run version for that employee, ordered by
  `month DESC, version DESC, payrollRunId ASC`. The payslip ID comes only from
  `payroll_result_document.kind='payslip'`; draft rows therefore return null.
- `/payroll` and `/payroll/new` move fully to the payroll contract and use
  `readPayroll`/`managePayroll`, never `readHr`/`manageHr`. The list shows
  month, version, status, origin and result count, with `New payroll run` and
  `Import` actions only for `managePayroll`. Creation retains one idempotency
  key across a failed retry and generates a new key only after success or form
  reset.
- Payroll detail routes share one tab component in this exact order: `Overview`,
  `Validation`, `Results`, `Taxes and insurance`, `Accounting`, `Documents`,
  `Submissions`, `Corrections`. Every tab preserves the organization selector.
- Overview shows run identity, month/version, status/origin, predecessor, and
  approval/finalization/payment actors and timestamps. Validation shows coded
  validation issues and exposes only the legal next command: validate for a
  draft, submit for a valid validating run, approve with `approvePayroll` or
  reject with `managePayroll` for a ready run, and finalize with `managePayroll`
  for an approved run. Rejection requires a reason modal.
- Results uses `DataGrid` for employee ID, gross, net, deductions and employer
  cost. Taxes uses `DataGrid` for employee/employer social and health, income
  tax, and other deductions. Accounting shows exact aggregate debit and credit
  categories derived from the immutable recorded results and labels them as a
  preview until finalized; after finalization it links the header document.
- Documents shows the nullable header payroll document and explains that each
  finalized employee payslip is linked from that employee's payroll history. It
  never invents a document ID or exposes an employee name in a document title.
  Submissions shows approval history and liabilities; `record-payment` is
  visible only for a finalized run with `managePayroll` and requires paidAt and
  paymentReference. Corrections shows the predecessor link and exposes
  correction creation only for finalized or paid runs with `managePayroll` and a
  required reason.
- `/employees/:id/payroll` appends `Payroll` to the shared employee tabs after
  `Compensation` and before `Documents`. It uses the employee payroll-results
  endpoint, URL-persisted month range and server paging, and a `DataGrid` with
  month, version, status, gross, net, employer cost, and a payslip document link
  when present.
- Every command page keeps one UUID idempotency key across a failed retry and
  replaces it only after success or explicit reset. Buttons are hidden without
  their capability and illegal-state buttons are absent. Every data-bearing page
  covers access loading/error, forbidden, data loading/error, empty, and ready
  states. No page calls an application service directly or recreates the product
  shell.

### Wave 3 endpoints

```text
GET|POST /employees/:id/schedules
POST /employees/:id/schedules/:scheduleId/publish
GET|POST /employees/:id/timesheets
PATCH /employees/:id/timesheets/:timesheetId
POST /employees/:id/timesheets/:timesheetId/submit
POST /employees/:id/timesheets/:timesheetId/approve
POST /employees/:id/timesheets/:timesheetId/reject
POST /employees/:id/timesheets/:timesheetId/correct
GET|POST /hr/leave-types
PATCH /hr/leave-types/:id
GET|POST /employees/:id/leave-requests
POST /employees/:id/leave-requests/:requestId/decide
POST /employees/:id/leave-requests/:requestId/cancel
GET /employees/:id/leave-balances
POST /employees/:id/leave-ledger
GET|POST /employees/:id/absences
PATCH /employees/:id/absences/:absenceId
```

### Wave 4 endpoints

```text
GET|POST /hr/employee-user-bindings
POST /hr/employee-user-bindings/:id/verify
DELETE /hr/employee-user-bindings/:id
GET /my-hr/access
GET /my-hr/profile
GET /my-hr/documents
GET /my-hr/payslips
GET|POST /my-hr/timesheets
PATCH /my-hr/timesheets/:timesheetId
POST /my-hr/timesheets/:timesheetId/submit
GET /my-hr/leave-types
GET|POST /my-hr/leave-requests
POST /my-hr/leave-requests/:requestId/cancel
```

Binding list requires `manageHr` and applies its legal-entity scope. Its strict
query is `legalEntityId?`, `status?`, `page?`, and `pageSize?`; it returns
`{ items, page, pageSize, total }`, ordered by legal entity, employee, then ID.
An out-of-scope entity filter returns an empty page. Only an organization owner
may create or revoke a binding. Revoke uses HTTP 204 with no body. Verification
requires the pending binding's named, email-verified organization member. Own
routes require a verified active binding and never accept an employee ID. Own
mutations use the same state and validation contracts as Wave 3, but cannot
approve or decide. `GET /my-hr/leave-types` accepts only `q?`, `page?`, and
`pageSize?`; it returns the existing leave-type list shape, restricted to active
types in the binding's legal entity and ordered by code then ID. This endpoint
exists so the own leave form never asks an employee to enter an opaque UUID.

W4.2 own-record responses are fixed:

```text
GET /my-hr/profile:
  { employee, relationships }
  employee uses the operational employee shape; relationships use the existing
  employment-relationship shape and order by start date desc, id.

GET /my-hr/documents query: page?, pageSize?
  { items, page, pageSize, total }
  item: { documentId, title, documentDate, categoryId, relationshipId,
          approvalStatus, approvedAt, createdAt }

GET /my-hr/payslips query: fromMonth?, toMonth?, page?, pageSize?
  { items, page, pageSize, total }
  item: { payrollRunId, month, version, status, documentId,
          finalizedAt, paidAt }
```

Every W4.2 query resolves the active binding and own employee inside the same
tenant transaction; missing or revoked binding is 404. Documents require an
`operational` category, `approved` or `not_required` approval state, and no
current successor; they order by document date descending, then document ID.
Payslips require a `payroll_result_document.kind='payslip'` linked to that
employee and a run in `finalized`, `paid`, or `superseded`; they expose no
payroll amounts and order by month descending, version descending, then run ID.
Month range is inclusive, uses `YYYY-MM`, and rejects `fromMonth > toMonth`.
Both collections default to page 1 and page size 25, maximum 100. No response
contains `approvedBy`, private fields, compensation, tax identifiers, bank data,
or medical data.

### Wave 5 endpoints

```text
GET /notifications
POST /notifications/:id/read
```

Collections expose only the caller's notifications, newest first, with bounded
paging. Any current organization member may use the endpoint for their own rows;
it requires no HR/payroll capability and never exposes another user ID. A read
command is idempotent and returns 404 for another user's row.

### Wave 6 endpoints

```text
POST /payroll-runs/calculate-supplied
POST /payroll-runs/:id/corrections/calculate-supplied
GET /payroll-runs/:id/supplied-input-snapshots
```

Calculation requires `managePayroll` and an idempotency key. The create endpoint
accepts `{ legalEntityId, month, inputs }` and atomically creates one version-1
draft run, its payroll results, and its supplied-input snapshots. It returns 201
and creates nothing on any validation or persistence failure. The correction
endpoint accepts `{ reason, inputs }`, requires a finalized or paid source run,
takes the entity/month advisory lock, and atomically creates the next linked
draft version, results, and snapshots without changing the source. Same-key
replay returns the original result; a mismatched replay is 409. Snapshots
require `readPayroll`. Results remain subject to the existing validate, approve,
finalize, payment, and supersession state machine.

### Wave 7 endpoints

```text
GET /employees/analytics/headcount
GET /employees/analytics/time-absence
GET /employees/analytics/payroll-cost-liabilities
GET /employees/analytics/accounting-reconciliation
```

All 4 queries require `legalEntityId`. Headcount also accepts `asOf` (`date`,
default today in Europe/Prague). Time/absence accepts required `from` and `to`
dates. Payroll and reconciliation accept required `fromMonth` and `toMonth` in
`YYYY-MM`; every range rejects start after end and is limited to 24 months.

Response contracts are fixed:

```text
headcount:
  { asOf, activeHeadcount, fteAt40Hours }
time-absence:
  { from, to, approvedTimesheetCount, approvedWorkMinutes,
    approvedLeaveRequestCount, absenceCalendarDays }
payroll-cost-liabilities:
  { fromMonth, toMonth, payrollRunCount, grossPay, employerCost,
    openLiabilities, paidLiabilities }
accounting-reconciliation:
  { fromMonth, toMonth, payrollEmployerCost, accountingDebit,
    accountingCredit, difference, reconciled }
```

Headcount is distinct active employees with at least 1 relationship and current
employment term on `asOf`. `fteAt40Hours` is the sum of current-term weekly
hours divided by 40 and is labelled with that denominator. Time uses approved
timesheets only; work minutes are entry duration less breaks, bounded to the
requested dates. Approved leave counts requests, while absence calendar days are
inclusive overlaps clipped to the requested range. Payroll uses only the latest
non-superseded finalized or paid run per entity/month. Liability totals use
those runs. Reconciliation compares their employer cost with the latest derived
economic-event version linked to each payroll document; `difference` is payroll
employer cost minus accounting debit, and `reconciled` requires debit, credit,
and payroll employer cost equality. Money and FTE are decimal strings.

## Request body rules

JSON uses camelCase. Schemas are strict. A create request requires every
non-null database field without a database default; nullable fields are optional
and default to null. A PATCH is a strict partial, rejects `{}`, and uses
explicit `null` to clear a nullable field. Server-derived IDs, tenant IDs,
actors, timestamps, checksums, status history, and totals are never accepted
from the browser.

Command bodies are fixed:

| Command                                  | Body                                                                                                        |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Employee status transition               | `{ toStatus, effectiveAt, reason? }`                                                                        |
| Checklist task transition                | `{ status, skipReason?, documentId? }`                                                                      |
| Payroll validate/submit/approve/finalize | `{}` plus `Idempotency-Key`                                                                                 |
| Payroll reject                           | `{ reason }` plus `Idempotency-Key`                                                                         |
| Payroll record payment                   | `{ paidAt, paymentReference }` plus `Idempotency-Key`                                                       |
| Payroll correction                       | `{ reason }` plus `Idempotency-Key`; server assigns next version                                            |
| Publish schedule                         | `{}`                                                                                                        |
| Timesheet submit/approve                 | `{}`                                                                                                        |
| Timesheet reject                         | `{ reason }`                                                                                                |
| Timesheet correct                        | `{ reason }`; server assigns next version                                                                   |
| Leave decision                           | `{ decision, reason? }`; decision is `approved` or `rejected`                                               |
| Leave cancellation                       | `{ reason? }`                                                                                               |
| Leave-ledger opening/correction          | `{ leaveTypeId, relationshipId, effectiveOn, amount, source, reason }`; source is `opening` or `correction` |
| Supplied payroll calculation             | `{ legalEntityId, month, inputs }` plus `Idempotency-Key`                                                   |
| Supplied payroll correction              | `{ reason, inputs }` plus `Idempotency-Key`                                                                 |
| Notification read                        | `{}`                                                                                                        |

Private change requests and encrypted private profiles are deferred extensions;
they have no active request shape.

## Fixed source layout

Workers use these locations and do not create alternate modules:

| Scope                | API source                                                      | Web contract/client                  | Product routes                                                 |
| -------------------- | --------------------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------- |
| Wave 0-1 employees   | `apps/api/src/hr/`                                              | `apps/web/src/lib/hr/`               | `apps/web/src/app/(product)/employees/`, `hr-settings/`        |
| Wave 2 and 6 payroll | `apps/api/src/payroll/` and `apps/api/src/payroll-calculation/` | `apps/web/src/lib/payroll/`          | `apps/web/src/app/(product)/payroll/`                          |
| Wave 3 time/leave    | `apps/api/src/hr-time/`                                         | `apps/web/src/lib/hr-time/`          | `apps/web/src/app/(product)/time/`                             |
| Wave 4 self-service  | `apps/api/src/hr-self-service/`                                 | `apps/web/src/lib/hr-self-service/`  | `apps/web/src/app/(product)/my-hr/`                            |
| Wave 5 notifications | `apps/api/src/hr-notifications/`                                | `apps/web/src/lib/hr-notifications/` | product header and `apps/web/src/app/(product)/notifications/` |
| Wave 7 analytics     | `apps/api/src/hr-analytics/`                                    | `apps/web/src/lib/hr-analytics/`     | `apps/web/src/app/(product)/employees/analytics/`              |

Each API module uses `contract.ts`, `<domain>-repository.ts`,
`<domain>.controller.ts`, and adjacent `.test.ts`; database integration tests
use `<domain>.integration.test.ts`. Each web library uses `contract.ts` and
`client.ts`; BFF functions remain in the existing auth BFF module and each fixed
route remains a logic-free `route.ts`.

## Browser route contract

Every API shape has one fixed BFF route. BFF requests parse and rebuild queries
and bodies before minting the one-request resource token.

```text
/employees
/employees/new
/employees/[employeeId]
/employees/[employeeId]/employment
/employees/[employeeId]/compensation
/employees/[employeeId]/time
/employees/[employeeId]/leave
/employees/[employeeId]/payroll
/employees/[employeeId]/documents
/employees/[employeeId]/workflows
/employees/[employeeId]/audit
/payroll
/payroll/import
/payroll/[payrollRunId]
/payroll/[payrollRunId]/validation
/payroll/[payrollRunId]/results
/payroll/[payrollRunId]/taxes
/payroll/[payrollRunId]/accounting
/payroll/[payrollRunId]/documents
/payroll/[payrollRunId]/submissions
/payroll/[payrollRunId]/corrections
/time
/time/timesheets
/time/approvals
/time/leave
/time/calendar
/hr-settings
/hr-settings/structure
/hr-settings/documents
/hr-settings/checklists
/hr-settings/payroll
/hr-settings/access
/employees/analytics
/my-hr
/my-hr/documents
/my-hr/payslips
/my-hr/time
/my-hr/leave
/notifications
```

Top-level reserved slugs added in their first owning wave are `time`,
`hr-settings`, `my-hr`, and `notifications`. Employee and payroll child
navigation uses tabs. Employee tabs are added only when their route exists while
retaining the fixed final order. W1.4 renders `Overview`, `Employment`; W1.6
appends `Documents`; W1.7 appends `Workflows`; later waves insert their routes
in the final order. Loading, empty, error, forbidden, and success states are
required for every data-bearing page. Mutation pages hide controls without the
corresponding capability and still rely on API enforcement.

Every product page uses `PageContainer`. Lists use the shared `DataGrid`, a
heading/action row, a filter row, and pagination in that order. Forms use Carbon
form controls inside `Stack`; submit is the only primary button and cancel is
secondary. Detail child routes use one shared employee or payroll tab component,
with the route list in this contract as its exact tab order. Pages add no custom
shell, breadcrumb, table implementation, literal user-facing string, inline
style, or direct Carbon import.

Wave 1 reference settings use this fixed browser behavior:

- `/hr-settings` redirects to `/hr-settings/structure` while preserving the
  `organization` query value. The rail destination is `HR settings`, uses the
  existing `Settings` facade icon, and links to `/hr-settings/structure`.
- Both settings pages show local links in this order: `Structure`, `Documents`.
  Later waves append their settings links; Wave 1 does not render links to
  unimplemented routes.
- `/hr-settings/structure` uses the `kind` query with exact values
  `departments`, `positions`, `cost-centres`, and `workplaces`; the default is
  `departments`. It requests only the selected collection.
- `/hr-settings/documents` requests only `document-categories`.
- Both pages rebuild `legalEntityId`, `q`, `active`, `page`, and `pageSize` from
  parsed browser query values. Changing the collection, entity, search, or
  active filter resets `page` to 1. The active filter has `all`, `active`, and
  `retired` UI values; only the latter two send `active=true|false`.
- The structure grids show `code`, `name`, the type-specific field when present,
  and `active`. The documents grid shows `code`, `name`, `retentionKey`,
  `requiresApproval`, and `active`. Server paging is preserved exactly.
- A create button is visible only with `manageHr` and a selected legal entity.
  It opens a Carbon modal. Row activation opens an edit modal only with
  `manageHr`; read-only users do not receive mutation controls.
- Create forms contain the selected `legalEntityId`, editable `code` and `name`,
  plus `parentId`, `addressLabel`, or the document-category fields where
  applicable. Department parent selection is a bounded, remotely searched list
  of active departments in the same legal entity and includes `No parent`.
  Document-category confidentiality is submitted as the fixed hidden value
  `operational`, not as a user-selectable field.
- Edit forms display immutable `code` as text and submit only changed mutable
  fields. `active=false` is the sole retirement action. Successful mutations
  close the modal, show a toast, and reload the current filtered page. Failed
  mutations keep the modal open and show an inline error.
- Until organization access resolves, the page shows loading and sends no
  reference request. Missing `readHr` shows the forbidden state and sends no
  reference request. Every list covers loading, empty, error, and ready states.

Wave 1 employment-term browser behavior is fixed:

- W1.4 moves relationship history and mutation out of the overview page into
  `/employees/[employeeId]/employment`; the overview stops exposing the legacy
  relationship update form because compatibility columns are read-only.
- The page loads the visible employee, relationships, employment-term history,
  and the 4 structure-reference collections for that employee's legal entity.
  Selectors use active references, page size 100, and remote `q` search when
  opened or typed. The manager selector uses the employee collection in the same
  entity.
- The history uses `DataGrid` with relationship, version, effective dates,
  position, department, workplace, weekly hours, and working-time pattern.
  Server paging and the optional relationship filter remain in the URL.
- `Add first term` is offered only for a relationship with no existing term.
  `Correct term` is offered only on a row without a successor. Both are hidden
  without `manageHr` and use a Carbon modal. A correction starts with every
  predecessor value, submits the full snapshot plus its predecessor ID, and
  never updates the displayed predecessor row.
- Successful creation closes the modal, shows a toast, and reloads the current
  page. A 409 stays in the modal with a conflict message. Other mutation errors
  stay in the modal with a general error. Loading, empty, error, forbidden, and
  ready states follow the common page contract.

Wave 1 employee-lifecycle browser behavior is fixed:

- The employee create page removes its status selector and submits an employee
  through the server's `preboarding` default.
- The overview displays status read-only and loads paged status history. It
  shows only the next legal actions: `Activate` and `Cancel` from preboarding,
  `Deactivate` from active, `Reactivate` and `Archive` from inactive, and none
  from archived or cancelled.
- A transition modal requires `effectiveAt`. `Reactivate` also requires reason;
  the other Wave 1 actions do not show or submit a reason. The modal submits the
  exact command body and remains open on 400 or 409 with an inline error.
- A successful transition closes the modal, shows a toast, and reloads employee
  and history. Mutation controls are absent without `manageHr`; loading,
  forbidden, empty-history, error, and ready states follow the common contract.

Wave 1 employee-document browser behavior is fixed:

- W1.6 moves the document list and mutation out of the overview into
  `/employees/[employeeId]/documents` and adds `Documents` to the shared tabs.
- The page uses `DataGrid` with title, document date, category, relationship,
  approval status, and current/superseded state. Category, approval, and current
  filters plus server paging remain in the URL.
- `Link document` opens a Carbon modal for document ID, operational category,
  optional relationship, and optional predecessor. Category and predecessor
  selectors are bounded and remotely searched where their source supports `q`.
- Row activation opens an edit modal for category, relationship, predecessor,
  and, only while pending, `Approve` or `Reject`. Controls are absent without
  `manageHr`. A successful mutation closes the modal, shows a toast, and reloads
  the current page; 409 and general failures remain inline in the open modal.
- Loading, empty, error, forbidden, and ready states follow the common page
  contract. Non-operational rows never enter browser state.

Wave 1 checklist browser behavior is fixed:

- `/hr-settings/checklists` uses `DataGrid` for templates and a second
  `DataGrid` for the selected template's ordered items. Legal entity, kind,
  active, search and paging state remain in the URL. Create/edit/retire template
  and create/edit/retire item flows use Carbon modals. Operational document
  categories are remotely searched; controls are absent without `manageHr`.
- W1.7 adds `Workflows` to the shared employee tabs and implements
  `/employees/[employeeId]/workflows`. The page keeps kind, checklist status,
  owner, due-before, selected checklist and paging state in the URL. One grid
  lists checklist instances and one lists the selected checklist's tasks.
- `Start checklist` selects an active same-entity template, optional employee
  relationship, start date and owner user ID. A task row exposes only the next
  legal actions. The command modal shows document ID when applicable and skip
  reason only for `Skip`, then submits the exact command body.
- A successful mutation closes its modal, shows a toast and reloads the current
  page. A 409 or general failure remains inline in the open modal. Loading,
  empty, error, forbidden, ready and read-only states follow the common page
  contract.

## Query and index contract

- Every collection is paged; no repository returns an unbounded array.
- Search uses `ILIKE` with escaped `%` and `_`. Employee search covers employee
  number, first name, last name, and work email.
- Stable sorting always ends with `id`.
- Indexes must support tenant/entity filters before sort columns.
- Required indexes:
  - employee
    `(organization_id, legal_entity_id, status, last_name, first_name, id)`;
  - payroll run
    `(organization_id, legal_entity_id, payroll_month desc, version desc, id)`;
  - employment term
    `(organization_id, relationship_id, effective_from desc, version desc)`;
  - checklist task `(organization_id, owner_user_id, status, due_on, id)`;
  - timesheet
    `(organization_id, legal_entity_id, period_start desc, status, id)`;
  - leave request `(organization_id, legal_entity_id, status, starts_on, id)`;
  - notification `(organization_id, user_id, read_at, created_at desc, id)`;
  - outbox partial index `(available_at, id) where processed_at is null`.
- Import parsers stream rows and retain at most 1,000 validation errors. A file
  over 5 MB or more than 10,000 rows is rejected before creating a payroll run.
- Payroll finalization and correction use a transaction-level advisory lock on
  `(legal_entity_id, payroll_month)` to prevent concurrent versions.

Collection queries are fixed:

| Collection               | Filters                                                    | Order before `id`                     |
| ------------------------ | ---------------------------------------------------------- | ------------------------------------- |
| HR reference data        | `legalEntityId`, `q`, `active`                             | `code ASC`                            |
| Employment terms         | `relationshipId`, `effectiveOn`                            | `effective_from DESC`, `version DESC` |
| Employee documents       | `categoryId`, `approvalStatus`, `currentOnly`              | `created_at DESC`                     |
| Checklists/tasks         | `employeeId`, `kind`, `status`, `ownerUserId`, `dueBefore` | `due_on ASC`                          |
| Payroll runs             | `legalEntityId`, `month`, `status`, `origin`               | `payroll_month DESC`, `version DESC`  |
| Payroll imports          | `legalEntityId`, `status`                                  | `created_at DESC`                     |
| Employee payroll results | `fromMonth`, `toMonth`                                     | `payroll_month DESC`, `version DESC`  |
| Schedules/timesheets     | `employeeId`, `from`, `to`, `status`                       | `period_start DESC`                   |
| Leave requests           | `employeeId`, `leaveTypeId`, `from`, `to`, `status`        | `starts_on DESC`                      |
| Absences                 | `employeeId`, `kind`, `from`, `to`                         | `starts_on DESC`                      |
| Notifications            | `read`, `page`, `pageSize`                                 | `created_at DESC`                     |

Unknown query keys are rejected. Date ranges require `from <= to`. A referenced
filter ID outside scope returns an empty collection, not evidence of existence.

## Test contract

Every task names its files and focused command. Across a completed wave, tests
must cover:

- valid, malformed, duplicate, forbidden, and invisible/cross-entity requests;
- owner, admin, assigned HR role, unassigned member, reporting, backup, and
  eraser database roles where applicable;
- every permitted and forbidden state transition;
- idempotent replay and concurrent finalization;
- empty and failure UI states plus the primary success path;
- immutable rows rejecting SQL update/delete through `bap_api`;
- audit metadata containing no name, contact, amount, encrypted value, or file
  content;
- query page bounds and deterministic order;
- upgrade from `origin/main` plus user-erasure behavior.

Wave exit commands are fixed:

```bash
pnpm --filter @bap/ai build
pnpm --filter @bap/security lint
pnpm --filter @bap/security typecheck
pnpm --filter @bap/security test
pnpm --filter @bap/db lint
pnpm --filter @bap/db typecheck
pnpm --filter @bap/db test
pnpm --filter @bap/api lint
pnpm --filter @bap/api typecheck
pnpm --filter @bap/api test
pnpm --filter @bap/web lint
pnpm --filter @bap/web typecheck
pnpm --filter @bap/web test
pnpm test:integration
pnpm check
```

Browser-required waves run the disposable demo script for that wave. W0.10 adds
the canonical `pnpm demo:hr` and `pnpm demo:hr:down` scripts by reusing
`scripts/demo-lib.sh` and `playwright.operational.config.ts`; later waves extend
`tests/operational/hr.spec.ts` and continue to run `pnpm demo:hr`.

## Deferred-extension gate artifacts

These artifacts govern only deferred extensions and do not block active Waves
4-7:

| Gate                 | Required artifact                                                            | Required status                                                      |
| -------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Restricted dossier   | `docs/planning/hr-gates/restricted-data.md`                                  | `approved` by product owner and Czech privacy/payroll reviewer       |
| Czech-law calculator | `docs/planning/hr-rules/cz-<year>.md` plus fixture file                      | `approved` by payroll professional, source URLs and checksum present |
| Statutory adapters   | `docs/planning/hr-gates/statutory-<channel>-<version>.md` plus schema bundle | `approved`, official validator evidence present                      |

No implementation may enable restricted fields, a Czech-law rule set, statutory
schema, filing, or a “ready to file” label without its approved artifact.
