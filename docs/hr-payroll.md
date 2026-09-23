# HR and Payroll

> Status: Waves 0-4 are implemented in the current worktree. The delivery
> checklist, gates, and deferred scope are maintained in
> [HR execution tasks](planning/hr-execution-tasks.md).

## Purpose

HR connects tenant- and legal-entity-pinned employee records, employment facts,
payroll, time, leave, and self-service. Notifications, supplied-input payroll
calculation, and HR analytics are outstanding. Restricted personal data,
Czech-law inference, and statutory submission remain deferred.

## Delivered waves

| Wave | Current state                                                                                                                                                                                                    |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | Employee directory, relationships, employee document links, recorded payroll facts, arithmetic validation, and derived accounting events.                                                                        |
| 1    | Employee lifecycle/history, effective-dated employment terms, HR reference data, categorized employee-document approval/supersession, and checklist templates/tasks.                                             |
| 2    | Payroll access assignments, component and account mappings, CSV/XLSX staged import, versioned payroll commands, approvals, liabilities, finalization, corrections, payment recording, and payroll product pages. |
| 3    | Schedules, timesheets and correction workflow, leave types/requests/balances/ledger, absences, and HR time/leave pages.                                                                                          |
| 4    | Owner-managed employee-user bindings plus bound-user profile, operational documents, finalized payslips, own timesheets, and own leave requests.                                                                 |

Wave 4 browser-gate completion is not claimed here. Waves 5-7 are not delivered:
notifications and deadlines, supplied-input payroll calculation, and
analytics/operational closure remain outstanding.

## Security and tenancy

Every HR row carries `organization_id` and is protected by forced row level
security. Employees and payroll runs also carry `legal_entity_id` pinned to
`app.legal_entity` by a composite foreign key. The application resolves the
caller's legal-entity scope before every repository operation.

The capability check, entity filter, and database policy are all required. An
unknown record and a record outside the caller's scope both answer 404. Payroll
is separately assigned through `payroll_specialist`; a generic administrator
does not receive it. Employee self-service resolves one active employee-user
binding server-side and never accepts an employee identifier from the browser
for an own-record operation.

Names, work contacts, and compensation are personal data. Audit entries must
contain action names and identifiers only, never names, contact values, or
amounts. The module does not send HR data to a model provider.

## Stored facts

| Table                         | Purpose                                                                                                                                   |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `app.employee`                | Minimal employee master for one legal entity: stable number, name, work contact, and active/inactive status.                              |
| `app.employment_relationship` | Effective-dated relationship with kind (`employment`, `dpp`, `dpc`, or `executive`), position, department, cost centre, and weekly hours. |
| `app.employee_document`       | Tenant-pinned link from an employee to a document in the same legal entity.                                                               |
| `app.payroll_run`             | Immutable monthly run with a version, source document, and optional superseded run.                                                       |
| `app.payroll_result`          | One employee's supplied gross, net, tax, social, health, deduction, contribution, and employer-cost amounts.                              |

Birth numbers, birth dates, private addresses, private bank accounts,
dependants, declarations, health data, and insurer identifiers are deliberately
absent. They require a separately permissioned sensitive-data design.

## Payroll and time workflows

`POST /v1/organizations/:organizationId/payroll-runs` accepts a legal entity,
calendar month, version/correction reference, and at least one employee result.
It checks:

- every employee exists in the named legal entity and caller scope;
- each employee occurs once;
- gross pay equals net pay plus employee social, employee health, income tax,
  and other deductions;
- total employer cost equals gross pay plus employer social and health;
- a legal entity, month, and version is unique;
- a superseded run belongs to the same legal entity and month.

Payroll imports accept staged CSV/XLSX input only. A worker validates bytes and
records bounded coded errors; consumption creates one draft run atomically.
Drafts transition through validation, submission, approval/rejection,
finalization, and payment recording. Finalization creates the document,
liabilities, approvals, and balanced economic event in one transaction. A
correction is a new version; stored finalized facts have no update or delete
route.

Schedules, timesheets and corrections, leave types and requests, leave balances
and ledger entries, and absences are delivered with tenant/entity scope. Time is
stored as UTC instants. Approved leave is represented by append-only ledger
facts; no diagnosis or unrestricted medical note is stored.

## Accounting derivation

Payroll rule set `hr-payroll-2026.1` aggregates all employee results in the run.
Zero lines are omitted.

| Side   | Account | Amount                                  |
| ------ | ------- | --------------------------------------- |
| Debit  | 521     | Gross pay                               |
| Debit  | 524     | Employer social plus employer health    |
| Credit | 331     | Net pay                                 |
| Credit | 336     | Employee and employer social and health |
| Credit | 342     | Income tax                              |
| Credit | 333     | Other deductions                        |

The validated arithmetic makes total debits equal total credits. The existing
`app.economic_event` and `app.economic_event_line` tables remain the single
analytics path; HR does not create a parallel ledger.

## Application API

All routes are versioned `v1`, guarded by resource JWT and subject rate limits,
and mounted under `/organizations/:organizationId`.

| Method         | Path                                                                             | Capability                       | Result                                                          |
| -------------- | -------------------------------------------------------------------------------- | -------------------------------- | --------------------------------------------------------------- |
| GET/POST/PATCH | `/employees`, detail subresources, lifecycle, terms, documents, and checklists   | HR capability                    | Scoped employee lifecycle and workflow facts                    |
| GET/POST/PATCH | `/hr/*` references, assignments, leave types, and payroll settings               | Respective HR/payroll capability | Scoped setup and retirement operations                          |
| GET/POST/PATCH | `/payroll-runs`, commands, approvals, liabilities, imports, and employee results | Payroll capability               | Scoped payroll workflow and imported/supplied facts             |
| GET/POST/PATCH | Employee schedules, timesheets, leave, ledger, and absence subresources          | HR capability                    | Scoped time and leave workflows                                 |
| GET/POST/PATCH | `/my-hr/*`                                                                       | Active binding                   | Bound user's profile, documents, payslips, time, and leave only |

The browser mirrors these through fixed BFF route shapes. Query strings and
request bodies are parsed and rebuilt before a one-request resource token is
minted.

## Product pages

The product shell registers `/employees`, `/time`, `/my-hr`, `/payroll`, and
`/hr-settings/structure`. Employee detail provides Overview, Employment,
Compensation, Time, Leave, Payroll, Documents, and Workflows. Payroll provides
import, creation, results, validation, tax, accounting, documents, corrections,
and submissions views. `/my-hr` exposes only the bound user's permitted data and
mutations. An opaque identifier is never used as a breadcrumb label.

## Wave boundary

Waves 0-4 are implemented code. Their gate acceptance is tracked in
[HR execution tasks](planning/hr-execution-tasks.md), which is the source of
truth. This document does not claim the Wave 4 browser gate is complete.

## Deferred work

- Notifications and deadline delivery (Wave 5).
- Supplied-input payroll calculation (Wave 6).
- HR analytics and operational closure (Wave 7).
- Czech-law rate inference, benefit taxability, statutory exports, and
  submission receipts (outside the active roadmap).
- Sensitive employee records, retention enforcement, legal holds, and a
  dedicated HR role finer than owner/admin.
