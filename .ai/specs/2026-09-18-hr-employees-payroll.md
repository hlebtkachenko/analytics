# HR Employees and Payroll Analytics

**Date:** 2026-09-18

**Correction, 2026-09-20:** This spec is the Wave 0 employee and
imported-payroll slice of the complete
[HR delivery plan](../../docs/planning/hr-payroll.md). Its later-work questions
are now resolved as explicit gated waves in that plan.

## Problem

BAP has no structured employee or payroll facts. HR and payroll papers can be
registered only as generic documents, so the application cannot answer who is
employed by which legal entity, what monthly payroll cost was recorded, which
tax and insurance liabilities compose it, or which accounting entry and source
document support a number.

## Scope

- Legal-entity-scoped employees and effective-dated employment relationships.
- Employee directory, create flow, detail page, and Overview, Employment,
  Payroll, and Documents sections.
- Immutable, versioned monthly payroll runs with one result per employee.
- Payroll list, create flow, detail page, and Results, Taxes and insurance,
  Accounting, and Documents sections.
- Automatic payroll document registration and balanced derived entries using
  accounts 521, 524, 331, 333, 336, and 342.
- Owner/admin read and write capability gates, with no member access, always
  constrained by the existing legal-entity scope.
- Not in scope: payroll-rate calculation, payslips, attendance, leave, benefits,
  statutory filing/payment, private identifiers, addresses, bank accounts,
  dependants, health-insurer records, deletion of finalized history, or sample
  employee/payroll data.

## Design

Migration `20260918.0001_hr_payroll.sql` adds `employee`,
`employment_relationship`, `employee_document`, `payroll_run`, and
`payroll_result`. Every table carries `organization_id`; entity-owned roots use
the composite legal-entity foreign key and all children pin their tenant to the
parent. RLS follows the current role model. Corrections insert a later run
version linked by `supersedes_payroll_run_id`.

The application API adds an HR controller and repository under
`apps/api/src/hr`. Request and response schemas validate identifiers, dates,
enums, paging, and decimal strings. Creating a payroll run validates the
supplied arithmetic, creates a `payroll` register document, persists results,
and derives one economic event in one tenant transaction. It never derives
rates.

The web app mirrors contracts under `apps/web/src/lib/hr`, exposes only fixed
BFF routes, and adds `/employees` and `/payroll` to the shell. All visible text
uses i18n resources and all layouts use Carbon through the design-system facade.
The implementation follows
[the subsystem plan](../../docs/planning/hr-payroll.md).

## Security

Names and payroll amounts are personal data. Resource JWTs stay inside fixed BFF
routes; audit entries contain identifiers and action names, never names,
contacts, or amounts. Entity scope is resolved before every read/write. Phase 1
does not store high-risk identity, family, health, or payment data. No HR data
is sent to a model provider. Backup/reporting roles receive read-only access and
user-erasure tombstones creator attribution without deleting business records.

## Acceptance criteria

1. An authorized owner/admin can read, create, and update an employee inside a
   visible legal entity; a member cannot read or write and an out-of-scope
   entity answers 404.
2. Directory filtering and every employee detail section return only visible
   entity data and never expose an opaque ID in breadcrumbs.
3. Employment relationships validate dates and bounds and remain attributable to
   their employee and tenant.
4. Creating a payroll run refuses duplicate month/version, invisible employees,
   cross-entity employees, and inconsistent gross/net/employer-cost arithmetic.
5. A valid run creates a payroll document, immutable employee results, and a
   balanced event whose lines use the six documented accounts.
6. Payroll and employee document sections expose only registered documents in
   the caller's entity scope.
7. API, web mirror, BFF, page, RLS/integration, navigation, breadcrumb, icon,
   slug, and documentation tests cover the new contracts.
8. `pnpm check` passes; database integration tests pass when PostgreSQL is
   available.

## Compatibility and rollback

The migration is additive. Rollback means reverting application code and
restoring a pre-migration database; applied migrations are never edited. The
existing generic document API continues to read generated payroll documents.

## Later gates

- Sensitive HR records use the separately assigned, encrypted, purpose- and
  retention-aware boundary defined in the delivery plan.
- Statutory calculation and exports remain disabled until their current official
  schemas and payroll-professional fixtures pass the plan's activation gates.
- Organization-specific account mapping is deferred with the broader document
  rule-override design and is delivered in Wave 2.
