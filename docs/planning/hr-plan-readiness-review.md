# HR Plan Mechanical-Readiness Review

**Review date:** 2026-09-21 **Verdict:** rebaselined and ready for W4.1
**Implementation status:** Waves 0-3 complete

## Review target

- [HR delivery roadmap](hr-payroll.md)
- [HR mechanical execution contract](hr-execution-contract.md)
- [HR mechanical task packets](hr-execution-tasks.md)
- Active 2026-09-21 Wave 4-7 specs in `.ai/specs/`
- `.context/hr-progress.md`

The readiness target is not “one model implements the complete HR module.” It is
“one low-reasoning worker can execute one assigned task packet without making a
product, architecture, security, payroll-law, or rollout decision.”

## Prior blockers and resolution

| Prior blocker                                                  | Resolution                                                                                                                               | Result   |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Wave tasks described outcomes rather than edits                | Tasks now name allowed paths, ordered changes, tests, commands, preconditions, and stop behavior                                         | resolved |
| Future schemas were undefined                                  | Contract catalogs exact tables, columns, types, constraints, immutability, policies, grants, and indexes                                 | resolved |
| APIs and pages were only conceptual                            | Contract fixes endpoints, status codes, strict body rules, commands, collection filters, source layout, BFF rule, and browser routes     | resolved |
| Payroll create/finalize compatibility was unclear              | Existing runs backfill to finalized; new creates are drafts; only finalization creates document/event                                    | resolved |
| Wave 0 defects were left to discovery                          | W0.1-W0.5 enumerate contract mismatches, erasure, immutability, constraints, paging, corrections, locks, and audit                       | resolved |
| Tests were categories, not executable evidence                 | Every packet has focused commands; the contract fixes wave exits and the reusable operational-browser proof                              | resolved |
| API package bootstrap was nondeterministic                     | `@bap/ai` build is the mandatory first command before API checks                                                                         | resolved |
| Deferred legal extensions blocked operational delivery         | Restricted data, Czech-law rules, and statutory schemas remain default closed, but do not block active Waves 4-7                         | resolved |
| Query/index/import limits were unspecified                     | Contract fixes filters, stable orders, composite indexes, 5 MB/10,000-row imports, error cap, and advisory locking                       | resolved |
| Worker could invent module/file structure                      | Contract fixes API/web directories, file naming, migration names, BFF location, and product route tree                                   | resolved |
| Self-service authorization conflicted with static capabilities | Own access now resolves only through `/my-hr/access` and an active employee-user binding                                                 | resolved |
| Manager access was named without a safe scope contract         | Manager reporting lines remain data; delegated manager authorization is explicitly outside this delivery and HR users own team approvals | resolved |
| Legal-rule research could block the usable release             | Active calculation uses only supplied inputs; Czech-law rules, statutory schemas, and restricted-data approval are deferred extensions   | resolved |

## Architecture review

- Applications continue to import packages, never each other.
- Database access remains through `@bap/db`; browser access remains through
  fixed BFF routes and resource JWTs.
- Documents and economic events are reused instead of creating a second ledger
  or attachment store.
- Tenant RLS, legal-entity scope, feature capabilities, and own-record binding
  are separate enforcement layers. Restricted encryption remains a deferred
  extension concern.
- Multi-table mutations, audits, finalization, calculator creation/correction,
  and notification delivery have explicit transaction boundaries.
- Queue work reuses pg-boss and re-resolves access at dequeue.
- Migration/backfill/rollback behavior is specified for every non-additive
  transition.

No unresolved architecture decision remains before W4.1.

## Code-quality review

- Boundary validation uses strict Zod contracts and mirrored web schemas.
- JSON casing, nullable clearing, state-command bodies, status codes, and
  idempotency behavior are fixed.
- Existing project patterns are named for audit, queue, page shell, grids,
  translations, icons, slugs, and operational browser proof.
- Workers cannot add packages or alternate modules.
- Versioned facts replace historical mutation for employment, compensation,
  time, payroll, and supplied-input snapshots.

No unresolved code-organization choice remains for an assigned packet.

## Test review

- Unit, contract, repository, PostgreSQL integration, RLS, browser, privacy,
  concurrency, upgrade, erasure, retry, and full-repository evidence are mapped.
- Every state machine requires all permitted and forbidden transitions.
- Supplied-input fixtures fix arithmetic and rounding without requiring a model
  or worker to interpret Czech law.
- A failed integration task returns to its owning production task and cannot be
  repaired opportunistically in the gate task.

No acceptance criterion depends only on a mocked boundary.

## Performance review

- Collections are bounded to page size 100 and use deterministic ordering.
- Employee search escaping, tenant-first composite indexes, import streaming,
  file/row/error caps, and payroll advisory locking are fixed.
- Outbox processing is bounded and indexed.
- No unsupported latency target or capacity claim was invented.

No remaining performance choice blocks an assigned packet.

## External stop gates

The following are intentionally not “resolved” by a coding model:

- restricted-data purpose and retention approval;
- yearly Czech payroll rules and professional fixtures;
- per-channel official statutory schema and validator evidence.

They are complete execution decisions for deferred extensions only. They do not
block self-service, in-app notifications, supplied-input arithmetic, analytics,
or operational closure.

## Assignment decision

The next authorized assignment is W4.1 only. Default worker model is
`gpt-5.6-luna` with low reasoning. The primary agent reviews the complete diff
and evidence before W4.2. Terra medium is an escalation for an observed blocked
packet, not the default executor.
