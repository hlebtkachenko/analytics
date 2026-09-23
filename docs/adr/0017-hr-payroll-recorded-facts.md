# ADR 0017: HR and Payroll as Recorded Facts

- Status: accepted
- Date: 2026-09-18

## Context

BAP needs HR and payroll analytics connected to legal entities, documents, and
accounting. Czech payroll calculation and statutory reporting depend on rules,
rates, thresholds, declarations, insurer data, and filing schemas that change
over time. Treating the first implementation as a calculator would make the
product appear authoritative before those rules, source dates, corrections, and
professional validation exist.

Employee and payroll information is personal data. The existing application uses
organization row level security and legal-entity scope, and the existing
document architecture separates a uniform register from structured content and
derived economic events.

## Decision

Phase 1 stores recorded facts supplied by an authorized source. An employee is a
minimal legal-entity-scoped master record. Employment relationships are
effective-dated children. Private identifiers, addresses, payment details,
dependants, declarations, health information, and insurer identifiers are not
stored until a separate sensitive-data authorization boundary exists.

A payroll run has workflow states and versioned recorded results. BAP validates
the arithmetic between supplied gross pay, deductions, net pay, employer
contributions, and total employer cost, but does not calculate a statutory rate
or decide whether a wage component is taxable. A correction preserves the
earlier finalized result and creates a later version.

Every payroll run creates a `payroll` document in the existing register and a
derived economic event. The event aggregates recorded results into accounts 521,
524, 331, 333, 336, and 342. The document is the traceable source; the economic
event is the rebuildable accounting view. This follows ADR 0012 rather than
creating a second accounting ledger for HR.

HR and payroll capabilities are resolved from organization roles and explicit
legal-entity assignments. Employee self-service is bound to the caller's own
employee record. These product gates supplement row level security and entity
filtering, not substitute for either.

## Consequences

- The module can answer employee, payroll-cost, tax/insurance-liability, and
  accounting questions without claiming statutory correctness.
- Imported values and their source documents stay traceable through one tenant
  transaction.
- Finalized results are not edited, so correction history remains intelligible.
- This decision established the recorded-facts foundation. Later HR waves add
  time, leave, self-service and workflow; calculation, notification jobs,
  statutory exports and analytics remain tracked separately.
- Organization-specific account mapping remains deferred with the document
  rule-override question from ADR 0012.
