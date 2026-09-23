# HR Wave 6: Statutory Exports and Submission Ledger

**Superseded, 2026-09-21:** Statutory adapters are a deferred extension. Active
Wave 6 is supplied-input payroll calculation.

**Date:** 2026-09-20

## Problem

Approved payroll facts cannot yet produce or track JMHZ, health-insurer, tax, or
other enabled statutory outputs and corrections.

## Scope

Implement W6.1-W6.4. Each channel is independently gated by W6.0 and implemented
against its approved schema bundle. Generate/validate/export files and record
manual receipts. Do not submit through an authority API or data box.

## Security

Payloads and receipts are immutable confidential payroll data. Queue messages
contain identifiers only and dequeue re-resolves access. Browser downloads are
no-store and permission checked.

## Acceptance criteria

1. A shared channel schema cannot be inserted or activated for a legal entity
   without approved schema/validator evidence.
2. Payload checksum, schema version, status, receipt, and correction chain are
   immutable and traceable.
3. Every enabled channel round-trips official fixtures.
4. Rejected submissions create corrections rather than mutating payloads.
5. Retry and revoked-membership paths fail safely.
6. W6.4 gates pass for every channel shown as available.

## Compatibility and rollback

Channels are individually default closed. Disabling one preserves its ledger and
receipts while preventing new exports.

## Remaining decisions

Only per-channel external approval artifacts.
