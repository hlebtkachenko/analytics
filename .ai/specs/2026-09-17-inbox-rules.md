# Inbox Rules (Phase 1b-rules)

**Date:** 2026-09-17

## Problem

Every item that arrives today waits for a person, even when the answer is always
the same: mail from `@dodavatel.cz` is a received invoice for entity Y, the
payroll channel is entity Z, a `.png` signature in an email is noise. The
planning document promises `app.inbox_rule`, "create a rule from this" and a
stored correction on override
([routing configuration](../../docs/planning/inbox.md#routing-configuration-and-rule-precedence),
[explanation](../../docs/planning/inbox.md#explanation-and-provenance)), and
`inbox_item.decided_by_rule_id` already exists with no table to point at
(`packages/db/drizzle/20260916.0001_inbox.sql:65-66`). This is the second of the
three stacked 1b pull requests, on top of 1b-runtime (routing target table,
quota setting, maintenance job) and before 1b-actions.

## Scope

- Migration `20260917.0005_inbox_rules.sql`: `app.inbox_rule`,
  `app.inbox_correction`, the `decided_by_rule_id` foreign key, two definer
  functions, the `rule_author_unavailable` event reason, erasure, grants,
  compatibility bump to `20260917.0005`.
- API: the rule matcher, the `rule` provider step, evaluation in the intake
  paths, the `route_inbox_item` and `rerun_inbox_rule` jobs, rule CRUD, order,
  adopt, corrections in the item detail, the 422 `not_available` refusal for an
  invoice-kind auto-route target.
- Web: `/inbox/rules`, "Create a rule" after a manual route or discard, the
  corrections list in the explanation panel, BFF routes and Zod mirrors, the
  routing-targets settings copy for an invoice-kind target.
- Out: amount or regex conditions (no extraction yet), partner upsert,
  auto-route to datasets or partners, any learning from corrections, Split,
  versioning, fingerprint duplicates, bulk actions (1b-actions), connectors,
  ARES, AI, reply mail.

## Design

Migration. `app.inbox_rule`: `id`, `organization_id`, `name` (1..120),
`enabled boolean not null default true`, `priority integer` (nullable: a
soft-deleted rule frees its slot), check
`(deleted_at IS NULL) = (priority IS NOT NULL)`,
`unique (organization_id, priority) deferrable initially deferred` so a reorder
is one statement, `unique (id, organization_id)`. Conditions as closed nullable
columns, no jsonb: `channel_id` (composite FK to
`inbox_channel(id, organization_id)`, `ON DELETE RESTRICT`), `sender_pattern`
(lowercase, `@domain` or a full address, check
`~ '^(@|[^@[:space:]]+@)[^@[:space:]]+$'`, length <= 320), `keyword` (1..120,
stored as typed), `detected_type` (the `inbox_item_detected_type_check`
pattern). Check: at least one condition. Actions as nullable columns:
`set_legal_entity_id` (composite FK to `legal_entity`, `ON DELETE RESTRICT`),
`set_document_kind` (check IN the `DOCUMENT_KINDS` list of
`apps/api/src/documents/contract.ts:16-29`), `set_partner_id` (composite FK to
`partner`, `ON DELETE RESTRICT`), `set_assignee_id text`, `discard_reason`
(check IN the discard reasons), `auto_route boolean not null default false`.
Checks: at least one action; a discard rule carries no other action, because a
discarded item has no fields to set.
`created_by text not null default current_setting('bap.user_id', true)`,
`created_at`, `updated_at`, `deleted_at`. Index
`(organization_id, priority) where deleted_at is null and enabled`. FK
`inbox_item_decided_by_rule_fkey (decided_by_rule_id, organization_id) references inbox_rule(id, organization_id) on delete restrict`,
so a rule that decided an item is never hard-deleted. FORCE RLS; SELECT
`organization_id = current_setting('bap.organization_id', true) AND NOT app.role_is_channel()`;
INSERT
`... AND created_by = current_setting('bap.user_id', true) AND app.role_can_write()`;
UPDATE `app.role_can_write()`; no DELETE policy and no DELETE grant, so the only
delete is `deleted_at`. A `BEFORE UPDATE` trigger on `inbox_rule` refuses any
change to `created_by` other than to `current_setting('bap.user_id', true)`, the
adopt route, closing adopt-as-someone-else at the database. Writers are owner
and admin: `manageDocuments`
(`packages/security/src/access-contract.ts:134,158`) is the capability a route
already needs, and `app.role_can_write()`
(`packages/db/drizzle/20260910.0001_legal_entities.sql:75`) is its database
twin; no new capability, because `organizationCapabilitiesSchema` is strict and
ADR 0016 keeps it closed.
`inbox_rule_maintenance_select TO bap_owner USING (true)` (the shape of
`20260917.0001_inbox_channels.sql:309`) admits `app.list_inbox_rules()`, a
`SECURITY DEFINER` function owned by `bap_owner`, EXECUTE to `bap_api`. Because
it is owned by `bap_owner` it also reads `auth.member` and `auth."user"`, and
returns only the enabled, undeleted rules of
`current_setting('bap.organization_id', true)` whose `created_by` is a verified
`owner` or `admin` member of the organization, the same predicate as
`auth.resolve_membership` (`20260828.0001_auth_and_roles.sql:161-166`); it
raises when the setting is empty. Their conditions, actions, `id` and `priority`
come back, never `name` or `created_by`. Every other rule is paused, not
deleted: the rules page shows "paused: author unavailable" with the adopt
action. `app.record_inbox_automation_skip(item_id uuid, reason text)` is the
second definer: it inserts one `inbox_event` (`kind = 'failed'`, the reason,
`actor_user_id null`) for an item of the current organization whose status is
`needs_review`. It needs no new INSERT policy: the runtime spec's own
`TO bap_owner` INSERT policy on `inbox_event` (`WITH CHECK (true)`) already
admits `bap_owner`, and permissive policies OR together, so a same-named policy
here would fail the migration. The tenant boundary is the function body instead:
it filters
`organization_id = current_setting('bap.organization_id', true) AND status = 'needs_review'`,
raises when the setting is empty, and raises on any other reason than
`rule_author_unavailable`. `inbox_event_reason_check`
(`20260916.0001_inbox.sql:259`) gains `rule_author_unavailable`;
`inboxEventReasons` in `packages/db/src/schema.ts:312` gains a third list
`inboxAutomationReasons`.

`app.inbox_correction`: `id`, `organization_id`, `inbox_item_id` (composite FK
to `inbox_item`, `ON DELETE CASCADE`), `field` (check IN `kind`,
`legal_entity_id`, `partner_id`, `document_date`, `title`, `reference`,
`currency_code`: the fields the create form edits,
`apps/web/src/app/(product)/inbox/[itemId]/page.tsx:251-260`),
`suggested_value text`, `final_value text`, `source` (check IN `hint`, `rule`,
`target_default`, `provider`), `reason text` (<= 500), `created_by` with the
same default, `created_at`. Index `(organization_id, inbox_item_id)`. SELECT
excludes the channel; INSERT `created_by` plus `app.role_can_write()`; no UPDATE
or DELETE policy: a correction is a fact about one route. Grants: `bap_api`
SELECT, INSERT, UPDATE on `inbox_rule` and SELECT, INSERT on `inbox_correction`;
`bap_reporting` and `bap_backup` SELECT on both. Erasure (ADR 0008):
`inbox_rule.created_by`, `inbox_rule.set_assignee_id` and
`inbox_correction.created_by` join `app.erase_user` and the `bap_eraser` column
grants. `DATABASE_MIGRATION_COMPATIBILITY` (`packages/db/src/access.ts:39`)
becomes `20260917.0005`.

Matcher. `apps/api/src/inbox/rules.ts` holds a pure
`evaluateRules(rules, facts)` over the facts the item already has: `channel_id`,
`sender` (lowercased), `detected_type`, the primary filename, `hint_text`, and
for a `text` payload the blob text (at most `MAX_TEXT_BYTES`, read outside the
transaction). A rule matches when every non-null condition holds: `channel_id`
equal, `sender_pattern` equal to the sender or a suffix starting at its `@`,
`keyword` contained case-insensitively in any of the texts, `detected_type`
equal. The email subject is not stored anywhere (the 1a-email spec never stores
it), so it is not a keyword source; delta from the brief. Every matching rule
applies in priority order with first-writer-wins per field: a sender rule that
names the entity and a channel rule that names the kind compose without a rule
per combination, and the highest priority still wins any conflict. A discard
rule is terminal: the first one met discards the item
(`decided_by_kind = 'rule'`, `decided_by_rule_id`, event `discarded` with its
reason) and no later rule runs. `auto_route` is set by the first matched rule
that asks for it, and that rule becomes `decided_by_rule_id` of the route.
Precedence per field is hint, rule, target default, provider: a hint a person
set (`hint_kind`, `hint_legal_entity_id`, `hint_partner_id`) and the standing
channel hint copied at intake (`inbox-repository.ts:502-525` writes
`legal_entity_id` and `hint_kind`) both outrank every rule action for that
field, so a rule fills `inbox_item.legal_entity_id` only when it is null and
never touches a hint column. `PROVIDER_STEPS`
(`apps/api/src/inbox/contract.ts:59`) gains `rule`; the pass writes one
`inbox_item_extraction` row with `provider = 'rule'`, version `2026-09-17.1`,
the merged output (sniff plus hints plus rule actions: `legal_entity_id`,
`draft.kind`, `draft.partnerId`), the ordered reasons with one sentence per
action, `"rule 3: sender @dodavatel.cz sets legal entity Y"`, step `rule`,
weight 1, and the event `rule_matched` (`schema.ts:279`, unused so far) instead
of `classified`; `insertExtraction` (`inbox-repository.ts:445-480`) takes the
event kind as a parameter. A rule assignee lands in `inbox_item.assignee_id`
when it is null, recorded in the reasons, with no `assigned` event, because that
event kind means a person assigned. No match writes nothing.

When it runs. After the sniff inside the intake transaction for an upload and
for a `TenantAccess` intake (`inbox.service.ts:431-467`,
`receiveIntakeInTransaction`, `inbox-repository.ts:643-660`), for a
`ChannelAccess` intake in the same place under the channel principal, and for
every email child in `createChildren` right after `insertExtraction`
(`apps/api/src/worker/split-email-item.ts:678-679`), still inside the child's
transaction. All four paths read rules through `app.list_inbox_rules()`: one
read path, and the table policy stays closed to the channel, which only ever
sees the rule set through server code, never through a route. The writes the
pass needs are all admitted to a channel by 1a: the extraction insert, and
`inbox_item_channel_update` for `legal_entity_id`, `assignee_id`, `status`,
`decided_by_kind` and `decided_by_rule_id`
(`20260917.0001_inbox_channels.sql:356-371` forbids only routing and a person's
decision). Delta from the brief, which says the channel reads no rule: the
channel reads the matcher's columns through the definer and nothing else.

Auto-route. Fires only when (a) a matched rule has `auto_route`, or the
effective routing target for the detected type (the 1b-runtime
`app.inbox_routing_target` row, else the constant in
`apps/api/src/inbox/routing-targets.ts:17-42`) has `auto = 'always'`, or
`'above_threshold'` and the sniff confidence is at or above `threshold`; (b) the
destination is `documents` (a discard rule discards synchronously, above;
datasets and partners wait); (c) the resolved `kind` (hint, rule, then
`document_kind`) is not in `INVOICE_KINDS`
(`apps/api/src/documents/contract.ts:614-617`; `createDocumentRequestSchema`
refuses an invoice kind without an `invoice` block no 1b provider supplies,
`:639-644`): checked at enqueue time inside the same intake transaction as the
matcher, before any job exists. An invoice kind never enqueues
`route_inbox_item`; the reason is written directly on the `rule` extraction row
and the item stays in review; delta from the brief, auto-route to Documents
covers non-invoice kinds in 1b; (d) every other field
`createDocumentRequestSchema` requires
(`apps/api/src/documents/contract.ts:619-634`) is set: `legalEntityId` from
hint, item, rule, then `default_legal_entity_id`; `partnerId` optional from hint
then rule; `documentDate` is the date of `received_at`; `title` is the primary
filename, or the detected type when the item has none; `currencyCode` its
default; (e) the newest extraction has no issue. The intake transaction commits
first, then enqueues `route_inbox_item` with
`{ organizationId, itemId, ruleId }` (`ruleId` null for a target default),
`retryLimit: 3`, `retryDelay: 60`, `singletonKey = itemId`, the shape of
`enqueueSplitEmailItem` (`apps/api/src/inbox/inbox-queue.ts:24-29`); nothing
routes inside a request. This PR also edits the routing-targets settings page
copy for an invoice-kind target (the `isdoc_invoice` default is
`received_invoice`, `routing-targets.ts:31-35`) to say auto-route waits for the
ISDOC parser on the connections track.

The job does not go through `runTenantJob`, which throws before any transaction
when the subject has no write membership
(`apps/api/src/worker/job-context.ts:61-74`) and would leave no trace. It opens
a read-only transaction as `{ role: 'member', userId: 'system_automation' }`.
This spec owns that subject: ADR 0016 is amended in this PR to replace
`system_sweep` with `system_automation`, read-only, admitted to write nothing
except through `app.record_inbox_automation_skip`. The migration adds
`CHECK (id NOT LIKE 'system\_%')` on `auth."user"` beside
`user_id_not_channel_check` (`20260917.0001_inbox_channels.sql:539-540`) and the
matching refusal in `app.erase_user`, so the subject can never collide with a
real account. The read transaction passes `legalEntityIds = null` to `loadItem`
(`inbox-repository.ts:305-315`; `inbox_item_select` is organization-only,
`20260916.0001_inbox.sql:372-373`) and never calls `readEntityScope` for itself,
since its missing-row default (`tenant.ts:70-73`) would make a fake subject
unrestricted; it calls no `app.record_audit` either, since that function's
INSERT policy has no role check (`20260917.0001_inbox_channels.sql:485-486`) and
would otherwise let a system subject write an audit row. It reads the item, the
rule's `created_by` or the target's `updated_by`, and closes the transaction; a
member role writes nothing anywhere, because every write policy needs
`app.role_can_write()` or the channel. It then resolves that author with
`resolveMembership` (`packages/db/src/access.ts:405`) and its entity scope
(`readEntityScope`, `packages/db/src/tenant.ts:54`). Owner or admin whose scope
admits the entity: the tenant transaction opens as `{ role, userId: author }`,
so `document.created_by` and `document_file.created_by` are the author and
`role_can_write()` holds. Anything else (no membership, unverified, `member`,
scope excludes the entity, or an `erased_` tombstone): the job calls
`app.record_inbox_automation_skip(itemId, 'rule_author_unavailable')` in the
read-only transaction, the item stays `needs_review`, the job returns without
throwing and never escalates. Guardrails inside the author transaction, after
`loadItem(..., forUpdate = true)` (`inbox-repository.ts:304-315`) locks the row
so every human writer serializes against it and the race with a manual route
closes: `status` must be `needs_review` (never `routed` or `discarded`, never
anything a person decided: `decided_by_kind IS DISTINCT FROM 'user'`); a
person's hint is re-read and still wins per field; at most one attempt after a
human touch. A human touch is an `inbox_event` with `actor_user_id` not null of
kind `hint_added`, `assigned`, `restored`, `reopened` or `unrouted` (channel
events carry no actor, `inbox-repository.ts:439`, and intake events are excluded
by kind). Snooze writes no event (`inbox-repository.ts:1145-1177`), so it is not
a human touch; the job refuses separately while `snoozed_until > now()`. Every
attempt writes an `auto_route` extraction row; the job refuses when such a row
exists and no human touch is newer than it. Success: the existing
`routeToDocument` transaction body (`inbox-repository.ts:961-996`) with
`decided_by_kind` `rule` plus `decided_by_rule_id`, or `target_default` plus
`decided_by_user_id` = the target editor, and the reasons of the newest earlier
extraction carried into the `auto_route` row. Failure modes, each committed and
never retried: the draft fails `createDocumentRequestSchema` (extraction row
with issue `missing_required_field` and the field), the reference is taken
(`isDuplicateDocumentReference`,
`apps/api/src/documents/document-repository.ts:1225`, extraction row with
`reference_conflict`), the item changed under the job (refused, nothing
written). Only an infrastructure error throws and retries; after three the job
is dead in pg-boss and the item is untouched in `needs_review`.

Corrections. `routeToDocument` computes, from the newest pre-route extraction
and the hints, the suggested value and source of each draft field, and inserts
an `inbox_correction` row for every field whose final value differs; the route
request gains optional `correctionReasons` (field to one line, <= 500). A
discard writes none. Read-only: the item detail gains `corrections` and the
panel shows them under the explanation on a routed item. No learning loop.

Create a rule. After a manual route or discard the panel offers "Create a rule"
prefilled from the item: sender domain, channel, detected type; actions from
what the person chose: entity, kind, partner, assignee, or the discard reason.
Scope: future only, or also re-run on current `needs_review` items, which
enqueues `rerun_inbox_rule` `{ organizationId, userId, ruleId }` through
`runTenantJob` as the creator (a gone creator fails the job before any write;
the rule is new, nothing is lost). Untouched means no human touch event as
defined above; the job walks untouched `needs_review` items by `received_at`,
one `runTenantJob` call per item, the split's pattern
(`split-email-item.ts:563,603`), up to a per-job cap of 100 items, then
self-requeues with a cursor for the rest; it skips an item whose newest `rule`
extraction already carries this rule's id in its typed `draft.matchedRuleIds`
array, never by matching reason text; it applies the rule under the same
first-writer-wins against the item's current effective values, and enqueues
`route_inbox_item` only when the rule says `auto_route`. Adopt:
`POST .../rules/:ruleId/adopt` sets `created_by` to the caller, so a rule whose
author left or was erased runs again as someone who explicitly took it; `PATCH`
never changes `created_by`.

API and web. `GET`, `POST /v1/organizations/:organizationId/inbox/rules`,
`PATCH`, and `DELETE .../rules/:ruleId` (soft: `deleted_at`, `enabled = false`,
204), `PUT .../rules/order` (the full ordered id list, one transaction under the
deferred unique), `POST .../rules/:ruleId/adopt`, all under `manageDocuments`,
403 to a `channel_` subject like every non-intake route. `POST` refuses past 200
enabled rules per organization, checked at create, since intake latency is
bounded by rule count. `POST` and `PATCH` validate `set_legal_entity_id` and
`set_partner_id` against the caller's entity scope, so a restricted admin cannot
steer an item into an entity it cannot see, and answer 422 `not_available` for
`auto_route = true` with `set_document_kind` in `INVOICE_KINDS`. `GET` reports
the same author check `list_inbox_rules()` applies, so the page can mark a rule
"paused: author unavailable" and offer adopt. `inboxItemSchema` gains
`decidedByRuleId`; `inboxItemDetailSchema` gains `corrections`. The
`route_inbox_item` payload is a third member of the job payload union beside
`tenantJobPayloadSchema` and `channelJobPayloadSchema` (`job-context.ts:18-23`),
with required `itemId` and nullable `ruleId`; `tenantJobPayloadSchema` itself is
unchanged, and the `inbox-queue.ts` change belongs to this PR. `/inbox/rules`
under the reserved `inbox` segment (no new top-level route, rail unchanged)
renders `PageContainer` with a `DataGrid` of rules in priority order, move up
and down, enable and disable, edit, delete, adopt; the pattern of
`apps/web/src/app/(product)/inbox/channels/page.tsx`. The item page shows the
newest extraction's reasons, which now include the rule sentences, and the
corrections list.

This PR exports `composeDocumentDraft(item, matchedRules, effectiveTarget)` from
`apps/api/src/inbox/`, the same composer the auto-route job uses to fill the
destination create payload, and the constant `HUMAN_TOUCH_EVENT_KINDS`, also
from `apps/api/src/inbox/`; 1b-actions consumes both for bulk approve and list
colouring. Nothing else changes.

## Security

The rule author is the principal, as ADR 0016 answered. Not a system principal:
it would write tenant rows nobody is accountable for and need a policy that
admits it everywhere `role_can_write()` does, a second superuser inside RLS. Not
the channel principal: 1a built it unable to route, read the register or read
`audit_log`, and widening it would let a leaked intake token's channel create
documents. The author is checked twice, so a rule can only do what its author
can currently do on both paths: `app.list_inbox_rules()` admits only rules whose
author is currently a verified owner or admin member (read time, closes a
synchronous discard or other match), and the route job re-resolves the same
author at dequeue, never carrying it in the payload (covers entity scope and
time-of-check drift the read-time check cannot see). A demoted, removed,
scope-restricted or erased author means the rule stops: paused off the read set
synchronously, or skipped at dequeue with a visible event and no retry. A rule
never grants its author anything, since matching and routing both run under the
author's own current role and scope. Adoption is an explicit act of the adopter,
and a `BEFORE UPDATE` trigger refuses any other change to `created_by`. The
channel principal reads the matcher's columns through `app.list_inbox_rules()`
only, holds no SELECT on `inbox_rule` or `inbox_correction`, cannot write
either, and no route returns rule data to a channel. pg-boss payloads carry ids
only; audit entries record `inbox_rule.created`, `inbox_rule.updated`,
`inbox_rule.adopted` with ids and kinds only, and `inbox_item.routed` with
`decidedByKind` and `ruleId`, ids and enum values only, never a pattern, a
keyword, a correction value or a reason line. Rule conditions and correction
values are tenant data behind RLS; logs carry operation, reason code and ids.

## Verification

- `packages/db` integration: migration applies; RLS isolates rules and
  corrections across organizations; a channel context cannot select, insert or
  update either but `app.list_inbox_rules()` returns the caller's enabled rules
  only; member role cannot insert a rule; no hard delete path; the
  `decided_by_rule_id` FK refuses a delete under `bap_owner`; the condition,
  action and discard-exclusive checks; the deferred priority swap;
  `record_inbox_automation_skip` refuses a routed item and an unknown reason;
  erasure of the three columns; `bap_reporting` reads both tables.
- `apps/api` unit: matcher fixtures (sender exact and domain, keyword in
  filename, hint text and text blob, channel, type, priority order,
  first-writer-wins, discard terminal, no match); hint over rule per field;
  channel standing hint over rule; the `rule` extraction row and `rule_matched`
  event in the upload path, the channel intake path and `createChildren`;
  auto-route happy path (document created as the author, `decided_by_kind`,
  `routed` event, `auto_route` row); target default path with `updated_by`;
  author unavailable in each of the five ways writes the skip event and does not
  throw; one-attempt guardrail before and after a touch; `routed`, `discarded`
  and user-decided items refused; validation failure and `reference_conflict`
  commit without retry; invoice kinds stay in review; correction rows only for
  differing fields with the right source; rerun touches untouched items only and
  skips items already matched; controller matrix (403 for a channel subject,
  `manageDocuments`), OpenAPI document.
- `apps/web` unit: `/inbox/rules` page, reorder, soft delete, adopt; "Create a
  rule" prefill after route and after discard; corrections list; BFF mirrors.
- `pnpm check` locally; `pnpm test:integration` in CI.

## Open questions

- Dependencies on 1b-runtime, to be added there:
  `inbox_routing_target.updated_by` and `updated_at` (the target-default
  principal), a real gap the runtime spec adds, with erasure; the runtime helper
  is `routingTargetFor(detectedType, overrides)`, not `readRoutingTarget`, with
  the lazy override (row if present, else the constant).
- Whether a rule may fill `inbox_item.legal_entity_id` (visible to restricted
  scope from then on) or only the extraction row. Chosen: fill when null, the
  same pre-bind a channel does.
