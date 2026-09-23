# HR Module Delivery Plan

**Plan status:** rebaselined and execution-ready; stopped before W4.1 **Last
reviewed:** 2026-09-21 **Delivery currency and jurisdiction:** CZK, Czech
Republic

Mechanical execution is governed by:

- [the HR execution contract](hr-execution-contract.md), which fixes schemas,
  permissions, transitions, endpoints, routes, indexes, tests, and stop gates;
- [the HR task packets](hr-execution-tasks.md), which provide atomic worker
  assignments, allowed paths, exact changes, and verification commands;
- [the mechanical-readiness review](hr-plan-readiness-review.md), which maps
  every prior blocker to its resolution;
- the dated Wave 0-7 specs indexed in `.ai/specs/README.md`.

If a worker receives only this roadmap rather than one task packet, it must
stop.

## Delivery goal

Deliver a usable HR v1 that connects employee records, employment relationships,
compensation, time and absence, payroll, source documents, and accounting
analytics. The active remaining scope is employee self-service, in-app
notifications and deadline jobs, deterministic payroll arithmetic from fully
supplied inputs, and minimal analytics plus operational closure. The module
preserves legal-entity isolation, restricts confidential payroll data
independently from ordinary organization administration, and keeps every
imported or calculated payroll result traceable to immutable source facts.

The calculator does not encode or infer Czech legal rates, thresholds,
eligibility, caps, declarations, benefits, or filing rules. Restricted employee
dossiers, private change requests, a full Czech-law engine, statutory filing,
and email or SMS delivery are deferred extensions with separate activation
gates.

## Definition of complete scope

This program includes:

- employee directory, creation, profile, status, and lifecycle history;
- employment, DPP, DPČ, and executive relationships with effective dates;
- positions, departments, cost centres, workplaces, managers, and working-time
  arrangements;
- onboarding, changes, offboarding, and attributable checklists;
- employee documents through the existing document register;
- compensation agreements and effective-dated recurring and one-off wage
  components;
- schedules, time records, timesheet approval, absences, leave requests, leave
  balances, and corrections;
- imported payroll facts, deterministic supplied-input payroll arithmetic,
  payroll review and approval, corrections, payslips, liabilities, and payment
  status;
- supplied income-tax lines, social-insurance and health-insurance amounts,
  credits, deductions, net pay, and employer cost;
- derived accounting events, configurable account mappings, reconciliation, and
  employee/payroll analytics;
- audit history and operational recovery evidence;
- employee self-service for the employee's own approved documents, payslips,
  time, leave, and operational profile;
- identifier-only in-app notifications and deterministic deadline jobs.

The program does not include recruitment/ATS, performance reviews, learning
management, benefit marketplaces, workforce scheduling optimization,
international payroll, bank payment initiation, or legal advice. Those are
separate products or later programs. The deferred extensions listed above are
not part of the 46-task active roadmap and do not block it.

## Verified repository baseline

- Tenancy is organization-wide forced row level security plus
  application-enforced legal-entity scope.
- Browser data paths use fixed BFF routes and one-request resource JWTs.
- Product pages use the shared shell, `PageContainer`, translation resources,
  and Carbon through `@bap/design-system`.
- The document register already recognizes `hr_document`, `payroll`, and
  `tax_filing` kinds.
- Economic events are derived from documents through versioned rule sets. HR
  must reuse that path rather than create another ledger.
- The Czech chart contains accounts 521, 524, 331, 333, 336, and 342.
- An interrupted implementation already contains a partial employee/payroll
  slice. Its code is evidence, not a completed deliverable. Wave 0 reconciles
  and hardens it before any scope expansion.

## Product architecture decisions

### System-of-record boundary

BAP is the HR and payroll workflow and analytics system for data entered or
imported into this module. It is not authoritative for Czech law. An active-v1
calculation uses only explicit caller-supplied values and rounding instructions.
Each result keeps an immutable canonical input snapshot, checksum, calculator
version, and actor so it can be replayed exactly.

Imported payroll results and calculated payroll results share the same review,
approval, correction, document, and accounting path. Their origin is explicit:
`imported` or `calculated`. Imported runs validate arithmetic but do not claim
that BAP verified the rates.

### Data classes and access

| Class                | Examples                                                                                                                                                     | Required protection                                                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Operational HR       | Employee number, name, work contact, position, department, employment dates                                                                                  | `readHr` or `manageHr`, legal-entity scope, RLS                                                                                               |
| Confidential payroll | Compensation, payroll components, tax and insurance amounts, payslips                                                                                        | Separate `readPayroll`, `managePayroll`, or `approvePayroll` grant, legal-entity scope, RLS                                                   |
| Restricted personal  | Birth details, national identifiers, private address, bank account, tax residency, insurer identifiers, dependant/declaration facts, medical fitness outcome | Separate `readSensitiveHr` or `manageSensitiveHr` grant, field encryption, purpose and retention metadata, no analytics/model-provider access |

Phase 1 retains the current owner/admin `readHr` and `manageHr` mapping. Wave 2
added legal-entity-scoped payroll assignments; generic organization admins do
not receive payroll access merely because they are admins. Sensitive-HR roles
remain reserved for the deferred restricted-dossier extension. Employee
self-service uses a separately verified employee-user binding and grants no
organization capability. Manager reporting lines are stored as employment facts,
but delegated manager access is outside this delivery; team approval screens
remain restricted to HR users.

No HR value appears in audit metadata, URLs, exception text, telemetry, or
application logs. Audit rows contain action, resource type, opaque identifier,
actor, tenant, timestamp, and outcome only. HR data is never sent to an AI
provider.

### Employee and employment model

`employee` is a stable person record inside one legal entity. The same physical
person employed by 2 legal entities has 2 employee records. A future explicit
cross-entity identity link may relate them, but ordinary users cannot infer it.

`employment_relationship` is an effective-dated child. Supported kinds are
employment, DPP, DPČ, and executive. Multiple concurrent relationships are
allowed. Each relationship owns its contract facts, position/workplace, manager,
working-time pattern, compensation agreement, statutory identifiers, and
termination facts. Changes are new effective-dated versions, not silent
overwrites of historical terms.

Employee lifecycle status is derived from relationships where possible and can
be overridden only with a reason. Deactivation never deletes payroll, documents,
time records, or audit history.

### Documents and workflows

HR documents are registered in `app.document` and linked to an employee and,
when relevant, an employment relationship, payroll run, absence, or workflow.
The HR module does not create a second attachment store. Document categories
carry purpose, confidentiality class, retention policy, signature/approval
state, and current/superseded status.

Onboarding, employment changes, and offboarding use reusable checklist
templates. A checklist task has an owner, due date, state, optional linked
document, completion actor, and completion timestamp. Checklist completion does
not mutate employment facts implicitly.

### Time, absence, and leave

Schedules and actual time are separate. A schedule records planned shifts; a
time record stores actual start/end, breaks, overtime, night, holiday, standby,
and absence classification. DPP/DPČ uses the same time-record boundary.

Timesheets follow `draft -> submitted -> approved` with a correction creating a
new version. Leave follows `requested -> approved/rejected -> taken/cancelled`.
Balance transactions, rather than a mutable total, are the source of truth.
Entitlement calculation is rule-versioned and disabled until validated.

### Compensation and payroll

Compensation is effective dated. A component definition declares earning or
deduction, recurring or one-off, taxable/insurance treatment through a rule
reference, accounting mapping, and display behavior. Agreements never overwrite
historical values.

A payroll period is one legal entity and calendar month. Its state machine is:

`draft -> validating -> ready_for_approval -> approved -> finalized -> paid`

Validation may return the run to `draft`; approval and finalization require
different actors when at least 2 eligible users exist. Finalized runs and
results are immutable. A correction is a higher version linked to the run it
supersedes. A rejected or superseded run remains visible in history.

Finalization registers a payroll document and derives accounting events in one
tenant transaction. Payment state records confirmation/reference only; BAP does
not initiate a bank payment.

The first rule maps aggregated supplied results as follows:

| Side   | Account | Amount                                             |
| ------ | ------- | -------------------------------------------------- |
| Debit  | 521     | Gross wages                                        |
| Debit  | 524     | Employer social plus health insurance              |
| Credit | 331     | Net wages                                          |
| Credit | 336     | Employee and employer social plus health insurance |
| Credit | 342     | Employee income tax                                |
| Credit | 333     | Other deductions                                   |

Zero lines are omitted. Organization-specific mappings are effective-dated and
must still produce a balanced event. Re-derivation creates a new event version;
it never edits a finalized accounting view in place.

### Active supplied-input payroll calculator

The active calculator is pure, deterministic arithmetic. It accepts gross pay,
employee and employer social and health contribution lines, 1-4 tax lines, tax
credits, other deductions, and explicit rounding instructions. Money uses
decimal strings at the boundary and scaled integers internally. It creates a new
draft payroll run, results, and immutable snapshots atomically, or creates a new
correction version without changing its source run. Exact formulas and request
limits are fixed in the execution contract.

The product labels every output `calculated from supplied parameters`. It never
claims that a supplied rate or amount is legally correct. Tax bonuses,
net-positive adjustments, sickness calculations, annual reconciliation, and
other unsupported cases stay on the existing import/manual path.

### Deferred extension: full Czech-law calculation engine

Money uses decimal strings at boundaries and scaled integers internally. Dates
use Czech calendar periods and Europe/Prague only where a time zone is needed.
The engine is pure and deterministic. It accepts frozen employee, relationship,
compensation, time, absence, tax-declaration, and prior-period input snapshots,
then returns components, bases, contributions, tax, net pay, employer cost,
rounding, warnings, and statutory fields.

Rules are data/configuration reviewed as code, not downloaded into production.
Every rule set has an effective interval, source citations, fixture set,
reviewer, approval timestamp, and checksum. A new year or legal change produces
a new version. It cannot alter prior results.

Calculation activation requires all of these:

1. primary-source citations for every rate, threshold, eligibility, cap, and
   rounding rule;
2. independently prepared fixtures covering ordinary employment, DPP, DPČ,
   concurrent relationships, minimum/maximum bases, allowances, taxable and
   exempt benefits, sickness/absence interactions, termination, and correction;
3. comparison against a payroll professional's expected results;
4. property tests for arithmetic invariants and deterministic replay;
5. written approval recorded against the rule-set version.

Until that gate passes, the UI offers import/record mode only.

### Deferred extension: statutory outputs

Statutory channels are independent adapters with immutable payload versions,
validation results, export/submission status, receipts, and corrections:

- JMHZ/JMH through ČSSZ for the applicable employer and employee reporting;
- health-insurer HOZ and PPZ separately for each insurer;
- employee tax declarations, annual reconciliation inputs/results, and current
  Financial Administration outputs;
- employment registration and foreign-worker reporting where applicable;
- work-injury records as a separately restricted workflow.

The first delivery generates validated export files and records a manual
submission receipt. Direct API or data-box submission is a later adapter and
needs explicit credentials, signing, retry, and non-repudiation design. No
screen labels an export `ready to file` unless its exact schema version is
active and its validation has passed.

### Deferred extension: retention and data-subject operations

Retention is policy-driven by document/fact category, purpose, legal basis, and
jurisdiction. Statutory minimums are seeded from reviewed sources, including the
45-calendar-year retention for wage records needed for pension insurance, with
the documented shorter exception where applicable. A tenant may lengthen a
period but cannot shorten a statutory minimum. Legal hold suspends disposal.

Expiry produces a review queue. Disposal is attributable and removes or
irreversibly anonymizes only data whose legal basis and dependencies allow it.
Backups follow the documented backup lifecycle rather than pretending to erase
an individual row immediately. Data-subject export is purpose-scoped and never
includes another employee's or approver's confidential data.

## Page and route map

| Area              | Pages and sections                                                                                                                                                           |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Employees         | Directory, create, employee Overview, Employment, Compensation, Time, Leave, Payroll, Documents, Onboarding/Offboarding, Audit                                               |
| Payroll           | Period list, import/create, supplied-input calculator, validation, review, approval, run detail Results, Components, Taxes and insurance, Accounting, Documents, Corrections |
| Time and leave    | Team calendar, schedules, timesheets, approval queue, leave requests, balances, absence detail                                                                               |
| HR administration | Positions/departments/cost centres, document categories, checklist templates, component definitions, account mappings, HR access assignments                                 |
| Self-service      | My operational profile, documents, payslips, time, leave, and in-app notifications                                                                                           |

All product pages use the existing shell and fixed BFF pattern. Lists use shared
data-grid blocks with server-side filtering, sorting, and pagination. Dynamic
breadcrumbs resolve human labels and never expose opaque identifiers.

## API and event boundaries

- Requests validate identifiers, enums, dates, decimal strings, paging, and
  state-transition commands at the controller contract.
- Repositories always receive organization context, allowed legal-entity IDs,
  actor ID, and the already-authorized capability.
- Cross-entity references answer 404. Validation errors reveal no inaccessible
  record details.
- Every multi-table mutation and audit record is one tenant transaction.
- Commands use idempotency keys for imports, finalization, supplied-input
  calculation, correction, and notification production.
- List endpoints implement bounded paging, deterministic ordering, filters, and
  total count. They never return an unbounded employee or payroll collection.
- Domain events are transactional outbox records. Workers may create exports,
  notifications, and analytics projections, but the request path owns the
  authoritative state transition.

## Execution waves and dependency gates

### Wave 0: interrupted-slice reconciliation

1. Reconcile API/web contracts and existing tests.
2. Fix migration erasure behavior and revoke obsolete function access.
3. Enforce payroll run/result immutability in database privileges and RLS.
4. Add missing constraints, audit writes, filters, paging, and correction tests.
5. Verify document/economic-event ownership and deletion behavior.
6. Update architecture, route, database-isolation, and runtime documentation.
7. Pass focused tests, PostgreSQL integration, browser smoke tests, and
   `pnpm check`.

Exit: the original employee plus imported-payroll slice meets its dated spec.

### Wave 1: employee lifecycle and documents

1. Effective-dated employment terms, organization structures, manager/workplace
   references, and relationship history.
2. Employee edit flows and lifecycle state transitions.
3. HR document categories, links, supersession, approvals, and retention tags.
4. Onboarding/change/offboarding checklist templates and instances.
5. Directory/detail filtering, pagination, empty/error states, and audit view.

Depends on Wave 0. Exit: an HR administrator can manage the complete
non-sensitive employee lifecycle with attributable history.

### Wave 2: payroll workflow and accounting

1. Confidential payroll capabilities and legal-entity-scoped assignments.
2. Payroll period state machine, separation of duties, versioned correction,
   locking, and idempotency.
3. Multi-employee import with preview, row-level validation, partial-error
   report, and all-or-nothing finalization.
4. Component/liability breakdown, payslip document generation, and employee
   payroll history.
5. Effective-dated account mappings, event versioning, reconciliation, and
   payment-status recording.

Depends on Wave 1. Exit: imported payroll can be reviewed, approved, finalized,
corrected, traced to documents, and reconciled to accounting.

### Wave 3: time, leave, and absence

1. Working-time arrangements, schedule versions, and actual time records.
2. Timesheet submission, HR approval, and correction.
3. Leave types, requests, approvals, balance ledger, and team calendar.
4. Absence categories and payroll-input export, without medical diagnosis data.
5. DPP/DPČ time and leave rules behind versioned calculation gates.

Depends on Wave 1; may run alongside Wave 2 after access assignments exist.
Exit: approved time and absence facts are complete, versioned payroll inputs.

### Wave 4: employee self-service

1. Verified active user-to-employee binding and own-record authorization.
2. Own operational profile, registered documents, payslips, timesheets, and
   leave requests. The employee ID always derives from the binding.
3. No private, bank, tax, dependant, or medical fields, and no change requests.

Depends on Waves 1-3. Exit: a bound employee can use only their own approved
records through fixed BFF routes.

### Wave 5: notifications and deadlines

1. Identifier-only outbox and per-user in-app notification records.
2. Events for checklists, relationship endings, liabilities, timesheets, leave,
   payroll state, and payslip availability.
3. Daily deadline and retry worker with idempotent, revocation-safe delivery.

Depends on Wave 4 binding and relevant Waves 1-3. Exit: users receive only their
authorized in-app notifications. Email and SMS are deferred.

### Wave 6: supplied-input payroll calculator

1. Immutable canonical input snapshots and a pure scaled-integer formula.
2. User-supplied gross wage, social and health bases/rates/rounding, tax
   lines/rounding, credits, and deductions produce existing payroll results.
3. Corrections preserve source snapshots and deterministic recalculation.

Depends on Wave 2 only. Output is labelled “calculated from supplied
parameters”; it makes no Czech-law rate, eligibility, cap, or filing claim.
Unsupported cases remain import/manual.

### Wave 7: analytics and operational closure

1. One HR and payroll analytics page for headcount/FTE, time/absence, payroll
   cost/liabilities, and accounting reconciliation.
2. Runbooks, accessibility, recovery, worker, and production-parity proof.

W7.1 depends on Waves 1-3 and 6; W7.2 depends on all active waves. Aggregate
access follows `readHr` and `readPayroll`, not blanket suppression.

## Deferred extensions

Restricted dossiers, private change requests, retention and legal holds, the
full Czech-law rule engine, statutory adapters or filing, and email
notifications are separate, default-closed extensions. Their existing approval
artifacts remain templates and are not blockers for Waves 4-7.

## Coding-agent orchestration

The primary agent owns decisions, integration, schema/contract reconciliation,
security review, and final verification. Research agents are not part of normal
execution. Official-source research is required only if a deferred Czech-law,
statutory, restricted-data, or retention extension is separately authorized.

For each wave:

1. Use at most 2 coding workers concurrently, only on independent paths.
2. Use `gpt-5.6-luna` with low reasoning for a mechanical task packet. Escalate
   only a concrete blocked packet to `gpt-5.6-terra` with medium reasoning after
   the primary agent identifies the unresolved code-level cause.
3. Give each worker exactly 1 task ID from the mechanical task packets. The
   packet's allowed paths, ordered changes, tests, commands, and stop rules are
   mandatory. Workers do not delegate further.
4. Typical split: backend worker owns database/security/API; frontend worker
   owns web contracts/BFF/pages. The primary agent owns shared-contract review,
   migrations that affect existing tables, integration tests, and final gates.
5. Do not start the next wave until the current wave's database integration,
   focused web/API checks, and documentation exit gate pass.
6. Use a higher-cost review model only for an observed consequential security,
   payroll-rule, or migration dispute, never as a ceremonial review.

## Verification matrix

| Boundary                | Required evidence                                                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Contracts               | Zod/API mirror tests, malformed-input refusal before token minting, OpenAPI assertions                                               |
| Tenancy and permissions | PostgreSQL RLS tests for owner, scoped HR role, ordinary member, cross-entity IDs, reporting, backup, and eraser roles               |
| State machines          | Unit and integration tests for every permitted/forbidden transition, idempotency, concurrent approval, correction, and locking       |
| Payroll arithmetic      | Supplied-input fixtures, property invariants, decimal/rounding boundaries, deterministic replay, imported/calculated provenance      |
| Accounting              | Balanced events, mapping versions, zero-line omission, correction/re-derivation history, reconciliation totals                       |
| Privacy                 | Redaction/log assertions, own-record isolation, payroll capability tests, identifier-only queue and notification payloads            |
| UI                      | Page tests plus Playwright for create/edit/detail, access denial, payroll review/finalize/correct, time/leave approval, self-service |
| Operations              | Migration upgrade from `origin/main`, backup/restore proof, notification worker retries, calculator replay, runbook review           |
| Repository gate         | Focused checks while iterating, then `pnpm test:integration` and `pnpm check` before push                                            |

## Rollout and rollback

- Every schema change is additive until its readers and backfill are deployed.
- New capabilities default closed. Employee binding, notification delivery,
  payroll calculation, and analytics always re-check active authorization.
- Backfills are idempotent, resumable, counted, and verified before a read path
  switches to the new representation.
- The calculator version is recorded on immutable snapshots. A new calculator
  version does not change finalized history.
- Application rollback keeps additive tables and old readers working. Applied
  migrations are never edited.
- No production rollout proceeds without a synthetic tenant proof containing no
  real employee or payroll data.

## Research baseline and refresh points

The plan relies on official sources checked on 2026-09-20:

- [ČSSZ JMHZ overview](https://www.cssz.cz/documents/20143/2045988/25-12%20Zpr%40vodaj%20%C4%8CSSZ%20%28prosinec%202025%29.pdf/69c8fc78-fc51-0eee-0c82-2cb3c7d4b835):
  JMH is electronic, monthly, versioned/correctable, and routed through ČSSZ.
- [ČSSZ pension-insurance employer duties](https://eportal.cssz.cz/documents/20122/35802/ELDP_2012_Ukoly_zamestnavatelu_pri_provadeni_duchodoveho_pojisteni.pdf/801c1914-1891-10cb-5e81-c3a8180dc645):
  wage records used for pension insurance have long retention requirements.
- [VZP employer reporting](https://www.vzp.cz/o-nas/tiskove-centrum/otazky-tydne/podani-prehledu-o-platbe-pojistneho-a-hromadne-oznameni-zamestnavatele):
  HOZ and PPZ remain separate from JMHZ and electronic.
- [Financial Administration employee/employer guidance](https://financnisprava.gov.cz/cs/dane/dane/dan-z-prijmu/zamestnanci-zamestnavatele/obecne-informace):
  tax declarations, annual reconciliation, and current form versions are
  separate payroll facts.
- [Financial Administration payroll-record GDPR guidance](https://financnisprava.gov.cz/cs/dane/dane/dan-z-prijmu/zamestnanci-zamestnavatele/informace-stanoviska-sdeleni/2026/sdeleni-pro-platce-dane-ze-zavisle-cinnosti-gdpr):
  payroll records contain prescribed personal data and require proportionate
  safeguards.
- [MPSV employment relationships](https://mpsv.gov.cz/pracovne-pravni-vztahy):
  employment, DPP, DPČ, written schedules, and lifecycle obligations.
- [MPSV DPP/DPČ changes](https://mpsv.gov.cz/novela-zakoniku-prace):
  working-time evidence also applies to DPP/DPČ.
- [Czech Data Protection Authority employer guidance](https://uoou.gov.cz/verejnost/qa-otazky-a-odpovedi/zamestnavatele):
  employee data collection must be necessary for a defined employment purpose.
- [GDPR](https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng): purpose limitation,
  data minimisation, retention accountability, integrity, and confidentiality.
- [SÚIP work-injury reporting change](https://www.suip.cz/web/suip/novinky?_com_liferay_asset_publisher_web_portlet_AssetPublisherPortlet_INSTANCE_Z8ivneU2D1Hv_mvcPath=%2Fview_content.jsp&_com_liferay_asset_publisher_web_portlet_AssetPublisherPortlet_INSTANCE_Z8ivneU2D1Hv_type=content&_com_liferay_asset_publisher_web_portlet_AssetPublisherPortlet_INSTANCE_Z8ivneU2D1Hv_urlTitle=co-se-zmeni-na-povinnem-hlaseni-pracovnich-urazu-od-1-ledna-2026&p_p_id=com_liferay_asset_publisher_web_portlet_AssetPublisherPortlet_INSTANCE_Z8ivneU2D1Hv&p_p_lifecycle=0&p_p_mode=view&p_p_state=normal&p_r_p_categoryId=1110793&p_r_p_reset=true):
  work-injury reporting is electronic from 2026.

Rates, thresholds, form versions, XML/data-sentence schemas, and retention rules
must be rechecked against primary sources immediately before a deferred legal or
statutory extension is implemented. This is not an execution gate for active
Waves 4-7, which contain no inferred Czech-law parameters.

## Plan completion statement

The goal, scope boundary, domain model, schema catalog, API and page contracts,
permission and state matrices, query/index requirements, task file boundaries,
verification commands, worker receipts, rollout approach, and deferred gates are
decided. Waves 0-3 are accepted. The next executable packet is W4.1. Work is
stopped here only to provide the requested reviewed plan and session handoff;
implementation remains authorized for the next session.
