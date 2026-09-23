# HR Wave 5: Czech Payroll Calculation

**Superseded, 2026-09-21:** This Czech-law engine is a deferred extension.
Active Wave 5 is in-app notifications and deadlines.

**Date:** 2026-09-20

## Problem

Imported facts support analytics but cannot deterministically calculate Czech
payroll or prove which effective rules and inputs produced a result.

## Scope

After W5.0 approval, implement W5.1-W5.5. Calculation stays inside the API, uses
immutable snapshots and the approved rule artifact, and supports only cases
represented by approved fixtures. Import mode remains available.

## Security and correctness

The pure function has no I/O, clock, environment, or network. Workers copy no
rate from prose or the internet. Rule activation requires checksums, source
citations, professional approval, golden fixtures, and deterministic replay.

## Acceptance criteria

1. Missing/invalid approval blocks insertion and tenant activation.
2. Shared rules and snapshots are immutable and checksum-verified.
3. Every approved fixture and arithmetic property passes.
4. Repeated calculation yields identical output/checksum.
5. Prior finalized results never change after a new rule version.
6. Comparison UI distinguishes imported and calculated provenance.
7. W5.5 gates and approval receipt verification pass.

## Compatibility and rollback

Deactivating a legal-entity assignment blocks new calculations only. The shared
rule and stored results retain their rule and input snapshot references.

## Remaining decisions

Only the externally approved yearly rule artifact and fixtures.
