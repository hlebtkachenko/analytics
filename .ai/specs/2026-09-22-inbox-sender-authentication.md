# Inbox Sender Authentication

**Date:** 2026-09-22

## Problem

`app.inbox_item.sender` is the address mailparser read from the `From` header of
the received MIME. Nothing verified it. A sender-pattern rule
([inbox rules](2026-09-17-inbox-rules.md)) may carry `auto_route`, so anyone who
learns an organization's intake address (`in-<32 hex>@<intake domain>`) can put
`From: billing@dodavatel.cz` on a message and have the platform create a
document on its own, deciding the legal entity, the kind and the partner from a
header the attacker wrote. `docs/security.md` already records the gap: the
address is stored unverified "so a rule that auto-routes on a sender trusts the
secrecy of the intake address". Secrecy of an address a person forwards mail to
is not an authentication boundary.

## Scope

- Migration `20260922.0008_inbox_sender_authenticated.sql`:
  `app.inbox_item.sender_authenticated boolean not null default false` with its
  column comment, and the compatibility bump to `20260922.0008`. Same table, so
  no RLS change.
- Worker: `senderAuthenticated(mail)` in `split-email-item.ts`, written on the
  parent beside `sender` and copied to every child through the intake input.
- API: `RuleFacts.senderAuthenticated`, filled wherever `RuleFacts.sender` is
  filled; a sender-pattern rule is skipped when `autoRouteRuleId` is chosen.
- Contract and web: `senderAuthenticated` on the item detail, shown beside the
  item status on `/inbox/[itemId]`.
- Out: SPF, DMARC policy evaluation, our own DKIM signature verification, a
  per-organization setting, ARC, any use of the flag outside the auto-route
  choice, and any change to the list contract (the list carries no `sender`).

## Design

The verdict is **DKIM alignment, not DMARC**. DMARC would additionally evaluate
the From domain's published policy and accept an SPF pass as an alternative
identifier; we evaluate neither. We require that Mailgun's own DKIM check passed
**and** that a `DKIM-Signature` header signs a domain relaxed-aligned with the
From domain, which is the identifier half of DMARC and nothing more.

Mailgun inserts `X-Mailgun-Spf` (`Pass|Neutral|Fail|SoftFail`) and
`X-Mailgun-Dkim-Check-Result` (`Pass|Fail`) into the headers of a received
message
(https://documentation.mailgun.com/docs/mailgun/user-manual/receive-forward-store/spam-filter.md).
Our MIME route stores the raw `body-mime`, so those headers are expected inside
the MIME the split parses. Only the DKIM verdict is read: SPF authenticates the
envelope sender, which is not the address a sender rule matches on.

`senderAuthenticated(mail: ParsedMail): boolean` is pure and returns true only
when all of the following hold.

- `x-mailgun-dkim-check-result` is present exactly once. mailparser returns an
  array for a repeated header, and an array is treated as not authenticated: a
  forwarder that lets an attacker append a second verdict header must never
  decide the outcome.
- That single value equals `Pass`, compared case-insensitively after trimming.
- `mail.from` yields an address with a domain.
- At least one `dkim-signature` header (one or many) carries a `d=` tag whose
  lowercased value equals the lowercased From domain or is a parent of it
  (`from === d` or `from` ends with `.` + `d`), which is RFC 6376 relaxed
  alignment. The tag list is parsed by splitting on `;`, tolerating whitespace
  and header folding inside a tag value.

Everything else, including a missing verdict header, a missing or unparsable
`From`, and no aligned signature, returns false. The function fails closed.

The parent update in `splitEmailItem` becomes
`set sender = $2, sender_authenticated = $3`, and `createChildren` passes the
same boolean into `receiveIntakeInTransaction`, which writes it on the child row
the same way it writes `sender`. Every other intake path passes `false`: an
upload and an API-channel item have no sender at all.

`RuleFacts` gains `senderAuthenticated: boolean`, read from the item row
wherever `sender` is read. A non-email item keeps `false`, which is harmless
because its `sender` is null and `senderMatches` already refuses a null sender.

In `evaluateRules` the flag changes exactly one decision: the choice of
`autoRouteRuleId`. A rule whose match relied on `senderPattern` still applies
its hints (legal entity, kind, partner, assignee) and still appears in the
reasons, but it is not eligible to auto-route while the sender is not
authenticated. A rule with no `senderPattern` is unaffected. A discard rule is
unaffected: a discard is reversible and moves nothing into the register.

The item detail contract gains `senderAuthenticated: boolean` beside `sender`
(Zod and the OpenAPI literal in `apps/api/src/inbox/contract.ts`, mirrored in
`apps/web/src/lib/inbox/contract.ts`). The list entry does not: the list carries
no `sender` today. `/inbox/[itemId]` renders a `StatusIndicator` beside the item
status whenever `sender` is not null: severity `success` with
`inbox.senderAuthenticated`, or severity `neutral` with
`inbox.senderUnverified`.

## Security

The change moves no new data and crosses no new boundary; it narrows an existing
one. The headers it reads are already inside a blob the platform stores, parsed
in the worker under the channel principal, and neither the verdict, the
signature, nor the domain is logged, audited or written to `inbox_event`: only
the boolean reaches a row. A `From` address stays untrusted display data, and
the intake address token remains the only binding of a message to a channel. The
flag is never a capability: an authenticated sender does not widen what a rule
may do, it only lets a rule that its author could already run reach the route
job. The route job still re-resolves the rule author and runs under that
person's role and scope.

Failure is closed in both directions. A verdict header that is missing,
repeated, or not `Pass` yields `false`, and so does a signature that does not
align; the item stays in `needs_review` and a person decides. The default of the
new column is `false`, so every row that predates the migration and every item
from a non-email channel is not authenticated.

## Verification

- `apps/api` unit (`worker/sender-authentication.test.ts`): aligned `d=`,
  parent-domain `d=`, `Fail`, missing header, repeated header, unaligned `d=`,
  and no `From`.
- `apps/api` unit (`inbox/rules.test.ts`): a sender rule with `auto_route` and
  `senderAuthenticated: false` yields its hints and `autoRouteRuleId: null`; the
  same rule with `true` yields its id; a rule that matched without a
  `senderPattern` is unaffected by the flag.
- `apps/api` integration (`worker/split-email-item.integration.test.ts`): one
  MIME fixture carrying both headers and an aligned signature leaves the parent
  and its children `sender_authenticated = true`, and the fixtures without those
  headers stay `false`.
- `apps/web` unit: the item page shows the authenticated and the unverified
  indicator.
- `pnpm check`, `pnpm --filter @bap/db test:integration`,
  `pnpm --filter @bap/api test:integration`.

## Open questions

- Whether Mailgun's `body-mime` carries the `X-Mailgun-*` headers in production
  is not stated in Mailgun's documentation, which describes them as added to the
  message during spam filtering. If they are absent from `body-mime`, every
  email is not authenticated and a sender rule simply never auto-routes, which
  is the intended fail-closed behaviour. To confirm against a real inbound
  message in staging; if they are absent, the follow-up is to verify the DKIM
  signature ourselves rather than to trust a Mailgun verdict.
- Mailgun's verdict is a check result, not a per-signature report, so a message
  whose aligned signature failed while an unaligned one passed would read as
  authenticated. Verifying the aligned signature ourselves closes that gap and
  is the same follow-up as above.
