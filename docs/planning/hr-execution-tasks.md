# HR Mechanical Task Packets

**Status:** ready for assignment **Contract:**
[HR mechanical execution contract](hr-execution-contract.md) **Rule:** assign
exactly 1 task ID to 1 worker

The primary agent checks the precondition, assigns the task, reviews the diff,
and records the receipt in `.context/hr-progress.md`. Workers follow the
contract literally. They do not take an entire wave at once.

## Default packet boundaries

An explicit `Allowed paths` line overrides these defaults. Otherwise, a worker
may change only the paths named in its packet, their adjacent test files, and
the fixed source-layout paths named for that wave in the execution contract:

- migration packets: the single named migration, `packages/db/src/access.ts`,
  and `packages/db/src/documents.integration.test.ts`;
- API packets: the wave's fixed API directory, its adjacent tests, and the
  minimal `apps/api/src/app.module.ts` wiring;
- web packets: the wave's fixed web library and product-route directories,
  matching BFF route files, shell registration, reserved-slug contract,
  translations, curated icon facade, and adjacent tests;
- documentation or gate packets: only the exact documents named by the packet;
- wave-gate packets: tests, demo scripts, and receipts only, with no product
  repair.

If a required change falls outside those paths, the worker stops and reports the
exact path and reason. It does not broaden scope.

## Focused verification commands

When a packet says to run focused gates, run every applicable row below in the
listed order. A worker records command, exit code, and failure summary in its
receipt.

| Changed scope | Exact commands                                                                                                                                      |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Security      | `pnpm --filter @bap/security lint`; `pnpm --filter @bap/security typecheck`; `pnpm --filter @bap/security test`                                     |
| Database      | `pnpm --filter @bap/db lint`; `pnpm --filter @bap/db typecheck`; `pnpm --filter @bap/db test`; `pnpm test:integration`                              |
| API           | `pnpm --filter @bap/ai build`; `pnpm --filter @bap/api lint`; `pnpm --filter @bap/api typecheck`; `pnpm --filter @bap/api test`                     |
| Web           | `pnpm --filter @bap/web lint`; `pnpm --filter @bap/web typecheck`; `pnpm --filter @bap/web test`                                                    |
| Design system | `pnpm --filter @bap/design-system lint`; `pnpm --filter @bap/design-system typecheck`; `pnpm --filter @bap/design-system test`                      |
| Documentation | `pnpm exec prettier --check .ai/specs docs/planning .context/hr-progress.md`; `git diff --check -- .ai/specs docs/planning .context/hr-progress.md` |

Wave-gate packets always run the complete exit list from the execution contract,
regardless of the focused rows above.

## Wave 0: reconcile the interrupted slice

### W0.1 API and web contract reconciliation

**Precondition:** current dirty HR worktree is preserved. **Allowed paths:**
`apps/api/src/hr/contract.ts`, `apps/api/src/hr/hr.controller.ts`,
`apps/api/src/hr/*.test.ts`, `apps/web/src/lib/hr/contract.ts`,
`apps/web/src/lib/auth/bff.ts`, `apps/web/src/lib/auth/bff.test.ts`.

Apply these exact changes:

1. Import `BadRequestException`; remove payroll-arithmetic handling from
   employee creation and add it to payroll-run creation.
2. Validate `relationshipId` and `payrollRunId` as UUIDs.
3. Add API employee/payroll list query schemas identical to the web schemas and
   parse them with `@Query`.
4. Make API and web employee update omit both `legalEntityId` and
   `employeeNumber`.
5. Make web payroll monetary inputs use the API's non-negative decimal pattern.
6. Make every response pass its response schema before returning.
7. Correct OpenAPI request schemas so create requests do not require response
   fields.

Add named tests for every mismatch above. Run:

```bash
pnpm --filter @bap/ai build
pnpm --filter @bap/api test -- hr
pnpm --filter @bap/api typecheck
pnpm --filter @bap/web test -- bff
```

### W0.2 Migration immutability and erasure

**Precondition:** `20260918.0001_hr_payroll.sql` has not been applied outside
disposable development databases. If it has, stop and request a new corrective
migration. **Allowed paths:**
`packages/db/drizzle/20260918.0001_hr_payroll.sql`,
`packages/db/src/documents.integration.test.ts`, and the exact migration,
reserved-slug, and eraser-ACL expectation blocks in
`packages/db/src/postgres.integration.test.ts`.

Apply these exact changes:

1. Remove payroll-run and payroll-result update/delete policies.
2. Grant `bap_api` `SELECT, INSERT` only on payroll tables; retain necessary
   update permission only on employee, relationship, and employee-document.
3. Replace `app.erase_user(text)` in place with one combined invoker-rights
   function. Do not rename or retain an `erase_user_before_hr` helper. Keep the
   function owned by `bap_owner`, revoke `PUBLIC`, and grant only the combined
   function to `bap_eraser`.
4. Reuse one tombstone across existing and HR attribution. Create it only when
   either class of attribution exists, return null when neither exists, and
   never assign null to `created_by`.
5. Add integration assertions for immutable payroll rows, absence of the old
   helper, combined-function-only execute, HR-only, old-only, mixed and
   non-existent-user erasure, one shared tombstone, reporting read, and
   cross-tenant denial.

Run `pnpm --filter @bap/db test:integration`.

### W0.3 Database constraints and indexes

**Allowed paths:** the Wave 0 migration and DB integration test only.

Add exact checks from the API boundary: trimmed names, work email length 254,
work phone length 64, department length 200, cost centre length 64, payroll
arithmetic equality, supersedes not self, and employee/result tenant
consistency. Change employee-number uniqueness to
`(legal_entity_id, employee_number)`. Add the employee and payroll indexes from
the execution contract. Add one rejection test per check and one positive
boundary test. Run DB integration tests.

### W0.4 Repository filtering, paging, and corrections

**Allowed paths:** `apps/api/src/hr/hr-repository.ts`,
`apps/api/src/hr/hr-repository.test.ts`, `apps/api/src/hr/contract.ts`, and
`apps/api/src/hr/hr.controller.ts`.

Replace unbounded lists with SQL filters, `LIMIT`, `OFFSET`, and a count query.
Escape employee-search wildcards. Return the requested page metadata. Enforce
that a superseded run has the same entity/month and a lower version. Acquire the
contracted advisory lock before checking/inserting a payroll version. Replace
row `any` values with explicit row interfaces. Add tests for all filters, page
bounds, deterministic order, correction mismatch, and concurrent version
conflict. Run API lint, typecheck, and HR tests.

### W0.5 Transactional audit coverage

**Allowed paths:** `apps/api/src/hr/hr-repository.ts` and its tests.

Inside the same tenant transaction, record these actions with `{}` or
identifier/count metadata only:

```text
employee.created employee.updated
employment_relationship.created employment_relationship.updated
employee_document.linked
payroll_run.created
```

Add tests proving rollback removes both mutation and audit, and metadata does
not contain name, email, phone, or amount values. Run API HR tests.

### W0.6 Employee UI completion

**Allowed paths:** employee product pages, `apps/web/src/lib/hr`, matching fixed
BFF route files, HR keys in `apps/web/src/i18n/resources.ts`, and adjacent
tests.

Use the legal-entity selector rather than a raw ID. Add edit employee,
create/update relationship, link document, paging/filter URL state, and explicit
loading/empty/error/forbidden states. Use `DataGrid` for the directory. Do not
add future-wave tabs. Add page tests for success, malformed input, capability
denial, empty list, and upstream failure. Run web lint, typecheck, and employee
tests.

### W0.7 Payroll UI completion

**Allowed paths:** payroll product pages, `apps/web/src/lib/hr`, matching fixed
BFF route files, HR translation keys, and adjacent tests.

Use the legal-entity selector and employee selector. Replace the single result
form with add/remove rows, refuse duplicate employees, show per-row arithmetic
errors, and submit at least 1 and at most 1,000 rows. Add list filters/paging
and detail sections from the Wave 0 spec. Add loading/empty/error/forbidden
states. Use `DataGrid` for results. Add tests for multi-row success, duplicate
refusal, arithmetic refusal without fetch, and capability denial. Run web lint,
typecheck, and payroll tests.

### W0.8 Route, icon, slug, and access contract closure

**Allowed paths:** existing navigation, breadcrumb, icon, slug, access-contract,
fixture, and their tests only.

Make the exact capabilities `readHr` and `manageHr` appear in every strict
access mirror and fixture. Keep the icon facade alphabetized and update its
exact export/callsite contracts. Reserve only `employees` and `payroll`. Make
breadcrumb fallbacks hide opaque IDs. Run design-system, security, and web
contract tests.

### W0.9 Documentation closure

**Allowed paths:** `ARCHITECTURE.md`, `docs/application-routes.md`,
`docs/database-isolation.md`, `docs/hr-payroll.md`, `docs/README.md`.

Document only behavior verified in Wave 0. Count fixed BFF shapes from actual
route methods, not from a remembered number. Mark later waves as planned, not
implemented. Run Prettier check on these files and `git diff --check`.

### W0.10 Wave 0 integration gate

**Allowed paths:** `tests/operational/hr.spec.ts`, `scripts/demo-hr.sh`,
`package.json`, and documentation only. Copy the existing `demo-documents.sh`
control flow, source `demo-lib.sh`, call
`demo_playwright_spec tests/operational/hr.spec.ts`, and add exact scripts
`demo:hr` and `demo:hr:down`. The browser spec creates neutral synthetic records
at runtime, proves owner/admin access and member denial, creates an employee,
adds a relationship/document, creates a multi-row payroll run, and opens both
details. No fixture employee/payroll data is committed. No production-code
repair is allowed in this task; a failure returns to its owning task.

Run every command in the execution contract's wave exit list, then run
`pnpm demo:hr`. Record the exact command receipt. Wave 1 remains blocked unless
every command passes.

## Wave 1: employee lifecycle and documents

### W1.1 Lifecycle schema

**Precondition:** W0.10 complete. **Allowed paths:** new migration
`packages/db/drizzle/20260920.0003_hr_lifecycle.sql`, DB access version, DB
integration tests.

Create every Wave 1 table, column, constraint, foreign key, policy, grant,
index, backfill, and compatibility rule exactly as cataloged. Add reserved slug
`hr-settings`. Extend erasure for attribution fields only. Test upgrade from the
Wave 0 schema, backfill equality, RLS, entity pinning, unique codes,
single-successor term versioning and deterministic current-term resolution, and
reporting/backup/eraser roles. Run DB integration tests.

### W1.2 Reference-data API

**Allowed paths:** new `apps/api/src/hr/reference-*` files,
`apps/api/src/hr/contract.ts`, `hr.controller.ts`, `app.module.ts`, and adjacent
tests.

Implement department, position, cost-centre, workplace, and document-category
endpoints exactly as contracted. Use one repository transaction per mutation,
identifier-only audit, active=false retirement, bounded paging, and 404 for an
invisible parent/reference. Add contract, repository, controller, OpenAPI, and
capability tests. Run API HR tests, lint, and typecheck.

### W1.3 Reference-data web

**Allowed paths:** `/hr-settings` redirect, `/hr-settings/structure`,
`/hr-settings/documents`, matching BFF routes, HR client/contracts,
navigation/breadcrumb/slug/i18n contracts, and adjacent tests.

Implement lists and create/edit forms using shared grids and Carbon components.
Reserve `hr-settings`. Add every UI state required by the contract. Add fixed
BFF routes for the W1.2 shapes. Run web tests, lint, and typecheck.

### W1.4 Employment-term vertical slice

**Allowed paths:** HR API contract/controller/repository/tests; employee
overview cleanup, shared employee tabs, `employment` page; matching
BFF/client/contracts/tests and adjacent i18n tests.

Implement term list/create, current-term read, and correction-by-new-version.
Never update a prior term. Populate selectors from reference endpoints. Reject
branching corrections and overlapping unsuperseded terms for the same
relationship while allowing concurrent separate relationships. Resolve the
current term exactly as defined by the execution contract. Test backfilled, new,
corrected, invisible-reference, and empty states. Run API and web focused gates.

### W1.5 Employee lifecycle transitions

**Allowed paths:** HR API files/tests; employee overview page/tests; BFF/client
HR files.

Implement the exact employee state machine and history endpoint. Require a
reason for inactive-to-active, the only Wave 1 manual override. Remove status
from employee create/update inputs and use the `preboarding` create default.
Status changes insert history and update the current employee status in one
transaction. Test every allowed and forbidden edge, concurrent conflict, and
audit metadata. Run focused gates.

### W1.6 HR document workflow

**Allowed paths:** Wave 1 lifecycle migration and DB integration tests for
document-supersession invariants; HR API files/tests; employee overview cleanup,
shared tabs and documents page/tests; fixed BFF routes; existing document
contracts only where a link field is required.

Implement category assignment, approval/rejection, and supersession fields on
the existing document link. Do not duplicate document content. In Wave 1,
category creation accepts `operational` only and every payroll/restricted link
is hidden. Wave 2 enables payroll categories through `readPayroll`; Wave 4
enables restricted categories through `readSensitiveHr`. Add tests for
cross-entity links, one-successor and supersession cycles, approval actor,
rejected non-operational category, hidden non-operational documents, paging,
filters, audit rollback, and immutable browser states. Run focused gates.

### W1.7 Checklist workflow

**Allowed paths:** Wave 1 lifecycle migration and DB integration tests for the
task document-category snapshot and its entity pinning; HR API files/tests;
`/hr-settings/checklists`; employee `workflows` page; matching
BFF/client/contracts/tests.

Implement templates, ordered items, checklist instantiation, and the exact task
state machine. Instantiation copies title/due offset/category into tasks so
later template edits do not rewrite history. Add tests for ordering, terminal
states, skip reason, due-date calculation, linked-document scope, and UI states.

### W1.8 Wave 1 gate

Run the full exit list and browser paths for structure setup, employment-term
correction, document approval, and checklist completion. Production-code fixes
return to W1.1-W1.7.

## Wave 2: payroll workflow and accounting

### W2.1 Payroll workflow schema and backfill

**Precondition:** W1.8 complete. **Allowed paths:** new migration
`packages/db/drizzle/20260920.0004_hr_payroll_workflow.sql`, DB access version,
DB integration tests.

Create/alter every Wave 2 object exactly as cataloged. Backfill existing runs
exactly as specified. Remove document/event creation from draft creation at the
schema contract level. Enforce append-only approvals and finalized facts. Add
all listed indexes, policies, grants, erasure attribution, and RLS tests.

### W2.2 Payroll access assignments

**Allowed paths:** security access contract/tests, API HR access files/tests,
web access mirror/tests, `/hr-settings/access`, and matching BFF routes.

Add the exact capabilities, base mapping, assignment expansion, owner-only
mutation, and scope intersection. Do not grant payroll to generic admins. Add
tests for every role/assignment/entity combination and revoked assignment.

### W2.3 Compensation and account-mapping vertical slice

**Allowed paths:** HR/payroll API files/tests; employee compensation page;
`/hr-settings/payroll`; BFF/client/contracts/tests.

Implement component definitions, employee effective-dated components, and
account mappings. Prior versions are never updated. Reject overlapping active
component periods for the same relationship/definition. Add all UI states and
focused gates.

### W2.4 Payroll import

**Allowed paths:** new `apps/api/src/payroll-import/**`, one forward W2.4
payroll-import migration plus its database integration test, existing queue
wiring, worker registration, payroll import page/BFF/client/contracts, and
adjacent tests.

Reuse the existing staged-upload and pg-boss patterns. Accept only CSV/XLSX up
to 5 MB and 10,000 rows. Queue identifiers only. Produce at most 1,000 coded row
errors. `consume` creates one draft run and results/components in one tenant
transaction or creates none. Test malformed files, duplicate employee,
out-of-scope employee, retry, revoked membership at dequeue, and all-or-nothing
behavior.

Use the exact W2.4 file columns, status transitions, response envelopes,
error-code vocabulary, staged-file lifecycle, capability recheck, and
import-to-run replay link in the execution contract. Do not invent alternate
columns or retain payroll values in queue payloads, logs, audits, or errors.

### W2.5 Payroll commands and state machine

**Allowed paths:** payroll API contract/controller/repository/tests, one forward
W2.5 command/idempotency migration with DB tests, removal of the superseded
payroll-run handlers/contracts from the HR module, and matching
BFF/client/tests.

Implement each Wave 2 payroll command endpoint and exact transition table.
Require UUID idempotency keys. Finalization uses the advisory lock, creates the
document, result documents, liabilities, approval row, and balanced economic
event in one transaction. Correction creates a higher draft version and copies
source results without editing the prior run. Add every transition, actor,
idempotency, rollback, and concurrency test.

Use the exact W2.5 command semantics, response shapes, validation codes,
accounting keys, liability dates, separation-of-duties function, correction
behavior, and command-receipt schema in the execution contract. The legacy HR
handler must not coexist with the payroll handler or retain `manageHr` access.

### W2.6 Payroll product pages

**Allowed paths:** payroll product pages/tests, employee payroll page/tests,
navigation/breadcrumb/i18n, the exact employee payroll-results API endpoint and
tests, and its matching web contract/client/BFF/fixed route files.

Implement import preview, validation, review, approval, results, tax/insurance,
accounting, documents, corrections, liabilities, and payment recording. Show
buttons strictly by capability and state. Add page tests plus browser scenarios
for approve/finalize, rejection, correction, and denied admin.

Use the exact W2.6 employee payroll-results response, payroll tab order,
page-by-page data/action ownership, idempotent retry behavior, paging/filtering,
capability gates, and state coverage in the execution contract. Do not fetch all
payroll runs and filter them in the browser, invent payslip identifiers, or add
an uncontracted payroll document endpoint.

### W2.7 Wave 2 gate

Run the full exit list, import browser proof, PostgreSQL concurrent-finalization
test, and accounting reconciliation proof. No later payroll wave starts on a
failure.

## Wave 3: time, leave, and absence

### W3.1 Time/leave schema

Create `20260921.0007_hr_time_leave.sql` with every Wave 3 object, constraint,
index, policy, grant, and immutable approved-row rule. Allowed paths are the
migration, DB access version, and DB integration tests. Test DST boundaries,
end-before-start, ledger append-only behavior, entity pinning, and RLS.

### W3.2 Schedule and timesheet API

Implement the contracted endpoints under new `apps/api/src/hr-time/**`, module
wiring, and tests. Store times in UTC and return ISO instants. Derive
categorized minutes from entries without trusting client totals. Implement the
exact timesheet state machine and correction versioning. Test Europe/Prague DST,
overlapping entries, approval actor, and immutable approved versions.

### W3.3 Leave and absence API

Implement leave types, requests, decisions, cancellation, balance read, ledger
transactions, and absences. Approval posts a negative request ledger entry;
cancellation posts its inverse; neither edits ledger history. Store no diagnosis
or unrestricted medical note. Add boundary and state tests.

### W3.4 Time/leave web

Implement the contracted `/time` routes, employee time/leave pages, fixed BFF
routes, client/contracts, shell registration, `time` reserved slug,
translations, and tests. Delegated manager access is outside this delivery; only
HR users see team views. Add browser proof for timesheet approval and leave
approval/cancellation.

### W3.5 Wave 3 gate

Run full exit commands and the browser proofs. Confirm approved time and leave
ledger facts can be read as payroll inputs without private medical data.

## Wave 4: employee self-service

### W4.1 Binding schema and API

**Precondition:** W3.5 is accepted. **Allowed paths:**
`packages/db/drizzle/20260921.0008_hr_self_service.sql`, DB access and
PostgreSQL integration tests, `apps/api/src/hr-self-service/**`, minimal
`apps/api/src/app.module.ts` wiring, and adjacent access tests.

Create `employee_user_binding` exactly as cataloged. Add forced RLS, grants,
tenant/entity foreign keys, erasure attribution, and the uniqueness constraints.
Implement `GET|POST /hr/employee-user-bindings`, verify, revoke, and
`GET /my-hr/access`. The bounded binding list requires `manageHr` and its
legal-entity scope; only owners create or revoke. Only the named user in a
verified session activates a pending binding; revoke is a soft status transition
and returns HTTP 204. Own access resolves at most 1 active binding and accepts
no employee ID. Test duplicate employee/user bindings, wrong-user verification,
revoked binding, cross-entity scope, RLS roles, erasure, paging, capability
scope, and the unavailable response. Run Database and API focused gates.

### W4.2 Own profile, documents, and payslips

**Allowed paths:** `apps/api/src/hr-self-service/**` and adjacent API tests.

Implement `GET /my-hr/profile`, `/documents`, and `/payslips`. Derive employee
and legal entity only from the active binding. Return only the operational
employee fields already exposed to HR, current registered operational documents,
and finalized payroll-result payslips. Do not return compensation, payroll
amounts, private contact, bank, tax, dependant, identifier, or medical fields.
Use the exact W4.2 response, filters, paging, and ordering contract. Resolve the
binding and records in one tenant transaction; unavailable/revoked binding
is 404. Test own-versus-other isolation, draft/non-payslip payroll exclusion,
document confidentiality/approval/supersession filters, month ranges,
legal-entity scope, paging, strict schemas, and OpenAPI. Run API focused gates.

### W4.3 Own time and leave

**Allowed paths:** `apps/api/src/hr-self-service/**` and adjacent API tests.

Implement `GET|POST /my-hr/timesheets`, `PATCH /my-hr/timesheets/:timesheetId`,
`POST /my-hr/timesheets/:timesheetId/submit`, `GET /my-hr/leave-types`,
`GET|POST /my-hr/leave-requests`, and
`POST /my-hr/leave-requests/:requestId/cancel`. Reuse Wave 3 validation and
state transitions. Resolve employee and relationship ownership server-side. The
own leave-type list accepts only `q?`, `page?`, and `pageSize?`, and returns
only active types from the binding's legal entity. Permit editing only an own
draft timesheet, submitting only an own draft, and cancelling only an own
cancellable leave request. Expose no approve, reject, decide, correction,
ledger, balance mutation, or other-employee operation. Test every permitted and
forbidden state plus cross-binding isolation. Run API focused gates.

### W4.4 Self-service web

**Allowed paths:** `apps/web/src/lib/hr-self-service/**`, matching fixed BFF
routes, `apps/web/src/app/(product)/my-hr/**`, shell navigation/breadcrumbs,
translations and adjacent tests; the `my-hr` web/database reserved-slug contract
and fixtures in `20260921.0008_hr_self_service.sql`; route inventory; and the
Wave 4 browser scenario in the existing HR demo/operational files.

Implement `/my-hr`, `/my-hr/documents`, `/my-hr/payslips`, `/my-hr/time`, and
`/my-hr/leave`. Parse and rebuild every body/query before token minting. Render
unavailable, loading, empty, error, ready, and revoked-binding states. Forms
offer only the W4.3 own mutations; the leave form selects from the own active
leave-type endpoint and never asks for a raw leave-type UUID. Add page and BFF
tests plus browser proof that 2 bound users cannot see or mutate each other's
records. Run Web focused gates and the database integration gate after extending
the reserved-slug constraint.

### W4.5 Wave 4 gate

**Allowed paths:** HR operational tests/demo, planning receipts, and necessary
test-only fixtures. No product repair is allowed in this packet.

Run the complete exit list, then the self-service browser isolation proof. Fail
on any private-field key in an own-route response or any cross-user access. No
restricted-data artifact is required because restricted values and change
requests are excluded. Record counts and commands in the tracker.

## Wave 5: notifications and deadlines

### W5.1 Notification schema and API

**Precondition:** W4.5 is accepted. **Allowed paths:**
`packages/db/drizzle/20260924.0001_hr_notifications.sql`, DB access and
integration tests, `apps/api/src/hr-notifications/**`, minimal module wiring,
and adjacent tests.

Create `hr_outbox` and `hr_notification` exactly as cataloged, including
non-negative attempts, append-only identifier payloads, dedupe key, unique
`(organization_id,event_type,dedupe_key)`, forced RLS, grants, erasure, and the
required indexes. Implement paged `GET /notifications` and idempotent
`POST /notifications/:id/read` for the current organization user, not only a
self-service employee. Test duplicate prevention, other-user 404, unread/read
filtering, stable paging, HR/payroll user access without an employee binding,
RLS, and forbidden payload values. Run Database and API focused gates.

### W5.2 Event producers

**Allowed paths:** the exact mutation repositories and adjacent tests in
`apps/api/src/hr/**`, `apps/api/src/hr-time/**`, `apps/api/src/payroll/**`, and
`apps/api/src/hr-notifications/**`.

Insert outbox rows in the same transaction as checklist changes, relationship
end-date changes, timesheet submit/approve/reject, leave submit/decide/cancel,
payroll state changes, and payslip availability. Use one deterministic dedupe
key per source transition. Payloads contain only event type, resource type,
resource ID, and legal-entity ID. Test source rollback removes its event and
retry/replay creates no duplicate. Run API focused gates.

### W5.3 Daily deadline and retry worker

**Allowed paths:** `apps/api/src/hr-notifications/**`, existing worker
registration files, and adjacent worker tests.

Register one daily pg-boss scan and a bounded delivery job. Emit checklist
events on due day and once the next day if still overdue; relationship-ending
events 30 and 7 days before end; liability events 7 days before, on due day, and
once the next day if still open. The dedupe key includes event, resource, and
trigger date. Before delivery, re-resolve current membership/capability or
active employee binding and legal-entity scope. Mark processed only after the
notification insert succeeds. Test clock boundaries, one event per trigger,
bounded retry, revoked access, duplicate job execution, and zero payroll values
in payload/log/audit. Run API focused gates.

### W5.4 Inbox and header web

**Allowed paths:** `apps/web/src/lib/hr-notifications/**`, matching fixed BFF
routes, `apps/web/src/app/(product)/notifications/**`, product header/shell,
`notifications` reserved-slug expectations, translations, and adjacent tests.

Implement `/notifications` for every authorized organization user and an unread
indicator in the product header. Use server paging, read/unread URL state, and
the exact read command. Render loading, empty, error, ready, and access-loss
states. Display event labels resolved from identifiers, never payroll amounts or
private values. Add BFF/page/header tests and browser proof for an HR user, a
payroll-only user, and a bound employee. Run Web focused gates.

### W5.5 Wave 5 gate

**Allowed paths:** HR operational tests/demo, planning receipts, and necessary
test-only fixtures. No product repair is allowed in this packet.

Run the complete exit list, daily worker/retry proof, and the 3-role browser
proof. Confirm the outbox has no duplicate dedupe keys and contains identifiers
only. Record evidence in the tracker.

## Wave 6: supplied-input payroll calculator

### W6.1 Snapshot schema and pure formula contract

**Precondition:** W2.7 is accepted. **Allowed paths:**
`packages/db/drizzle/20260924.0002_payroll_supplied_calculation.sql`, DB access
and integration tests, `apps/api/src/payroll-calculation/**`, and adjacent unit
tests.

Create the append-only snapshot table exactly as cataloged with forced RLS,
grants, erasure, unique run/employee constraint, checksum shape, and no API
update/delete. Implement strict input schemas and one pure scaled-integer
calculator. Money is a non-negative decimal string with at most 4 places; rates
are 0..100 with at most 6 places; rounding is unit `0.01|1.00` and mode
`half_up|up|down`; tax lines contain 1..4 entries; each request contains
1..1,000 unique employees. Implement exactly the formulas in the execution
contract and reject negative net. Add table-driven
rounding/formula/boundary/property tests and deterministic
canonical-JSON/checksum tests. Run Database and API focused gates.

### W6.2 API, repository, and corrections

**Allowed paths:** `apps/api/src/payroll-calculation/**`, the payroll
contract/controller/repository and adjacent tests, minimal module wiring, and
the W6 snapshot migration integration test.

Implement `POST /payroll-runs/calculate-supplied` and
`POST /payroll-runs/:id/corrections/calculate-supplied`. The first atomically
creates a version-1 draft run, results, and snapshots from
`{ legalEntityId, month, inputs }`. The second accepts `{ reason, inputs }`,
requires a finalized or paid source, takes the existing entity/month advisory
lock, and atomically creates the next linked draft version with new results and
snapshots. Neither endpoint accepts a pre-created draft. Persist canonical JSON,
checksum, calculator version, and actor. Require UUID idempotency, enforce
managePayroll/entity scope, and expose snapshot GET to readPayroll. Test atomic
rollback, replay/mismatch, concurrent correction, source immutability, formula
result mapping, and the output label. Run API and Database focused gates.

### W6.3 Calculator web

**Allowed paths:** `apps/web/src/lib/payroll/**`, matching BFF routes,
`apps/web/src/app/(product)/payroll/**`, translations, and adjacent tests.

Add a supplied-parameter creation flow and a correction flow on eligible runs.
Use one editable row per employee with the exact W6.1 fields and explicit
rounding controls. Reject duplicate employees and boundary errors before fetch.
Keep one idempotency key across failed retry. Show the immutable snapshot and
result with `calculated from supplied parameters`; direct tax bonus, sickness,
annual reconciliation, or other unsupported cases to import/manual. Add BFF,
page, arithmetic-preview, capability/state, and retry tests. Run Web focused
gates.

### W6.4 Wave 6 gate

**Allowed paths:** HR operational tests/demo, planning receipts, and necessary
test-only fixtures. No product repair is allowed in this packet.

Run the complete exit list plus live create, replay, correction, rollback, and
browser proofs. Compare stored results against the W6.1 fixture outputs and
confirm snapshots cannot be updated or deleted through `bap_api`. Record
evidence in the tracker.

## Wave 7: analytics and operational closure

### W7.1 Minimal analytics API and web

**Precondition:** W6.4 is accepted. **Allowed paths:**
`apps/api/src/hr-analytics/**`, minimal API module wiring,
`apps/web/src/lib/hr-analytics/**`, matching BFF routes,
`apps/web/src/app/(product)/employees/analytics/**`, employee navigation,
translations, and adjacent tests.

Implement the 4 fixed `/employees/analytics/*` endpoints and one
`/employees/analytics` page. Headcount/FTE and time/absence require `readHr`;
payroll cost/liabilities and accounting reconciliation require `readPayroll`.
Apply legal-entity filters in SQL, return aggregates only, and do not recompute
payroll. On one page, hide each unauthorized panel while rendering authorized
panels. Use authoritative tables, exact empty states, and no blanket group-size
suppression. Test each capability combination, cross-entity scope, aggregate
agreement with source facts, BFF validation, and page states. Run API and Web
focused gates.

### W7.2 Operational closure

**Allowed paths:** HR docs/runbooks, operational tests, demo scripts,
accessibility tests, planning receipts, and necessary test-only fixtures. No
product repair is allowed in this packet.

Update current-system documentation for Waves 4-7. Run the complete exit list
and synthetic end-to-end proof for self-service, notification retry/recovery,
supplied calculation/correction, capability-split analytics, backup/restore, and
production-parity startup. Run accessibility checks on every new page. Tear down
only the isolated demo Compose project and record all commands/counts in the
tracker. Any product failure returns to its owning task ID.

## Primary-agent integration checklist

After every worker receipt, the primary agent:

1. verifies only allowed paths changed;
2. reads the complete diff, not only the receipt;
3. checks contract/API mirror equality;
4. runs the smallest independent command that covers the change;
5. updates `.context/hr-progress.md` with evidence;
6. returns failures to the same task ID;
7. starts no dependent task until its gate is green.
