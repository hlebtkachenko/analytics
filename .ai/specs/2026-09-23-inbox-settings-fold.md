# Inbox settings fold into the Rules page

**Date:** 2026-09-23. Implements after PR #75 (`hlebtkachenko/inbox-ux`) lands
on main. Source of the decision: `.ai/specs/2026-09-21-inbox-ux.md`, section
"Settings, rules and channels: analysis only", and its Recommendation.

## Problem

Two pages answer "where does this file go": `/inbox/rules` (the rule stack) and
`/inbox/settings` (ten routing targets, eight columns, mostly "Never", "n/a",
"Platform default"). An accountant reads the targets table as machine
configuration. The same page carries the storage quota, an organization concern.
The assignee is a raw user id in both the column and the edit form.

## Scope

- `/inbox/rules` gets two sections: "Your rules" (today's grid, unchanged) and
  "Defaults by file type" (the routing targets as sentences).
- The storage quota moves to `/[orgSlug]/settings`.
- `/inbox/settings` becomes a redirect to `/inbox/rules`.
- The Sources wording reaches the breadcrumb and the channels page heading.
- Out: API, schema or BFF changes; rule rows as sentences; the channels page
  body; the required-fields input (stays a comma list in the edit modal).

## Design

**`/inbox/settings`.** `page.tsx` becomes an `async` server redirect, the
`/access` pattern: `await searchParams` (a Promise in this Next version), take
the first value when `organization` is an array, cast the result for typed
routes, and `redirect(withOrganization('/inbox/rules', slug))`, so a bookmark
keeps its organization. A plain removal would let `/inbox/[itemId]` catch
`settings` as an item id. `page.module.scss` moves to `_junk/`; `page.test.tsx`
becomes the two-case redirect test. No reserved slug change: the segment is
nested and `inbox` is already reserved. No rail change. The `settings` child
label and `shell.nav.inboxSettings` leave `breadcrumb-trail.ts` and its test.

**Menu.** The `/inbox` overflow (#75, `inbox/page.tsx`) keeps Sources and Rules
and drops Settings and the `inbox.settings` key. `shell.nav.inboxChannels` and
the channels page `h1` read "Sources"; the route stays `/inbox/channels`.

**Rules page load.** The shared `Promise.all` in
`apps/web/src/app/(product)/inbox/rules/page.tsx:189-213` gains
`GET .../inbox/routing-targets` (`manageDocuments`, as the page) wrapped in its
own `.catch` that resolves to an error marker, not `[]`, so a failed targets
read neither rejects the whole `Promise.all` nor is read as the empty state "You
have not changed any default." The Defaults section shows an inline error
instead and never hides the rules. Names resolve from `useLegalEntities` and
#75's `useMembers`.

**Defaults by file type.** The section opens with a fixed lead line, one i18n
key under `inboxRules.defaults`: "Your rules above and a source's standing hint
come first, including a rule's own auto-route; automatic filing still waits when
the legal entity or a required field is missing, the read raised an issue, or
the owner who saved the default is no longer an owner or admin." Then a Carbon
`ContainedList` of the targets with `source = 'organization'` in
`DETECTED_TYPES` order, labelled "Changed defaults" ("You have not changed any
default." when empty). Below it a closed `Accordion` item "Defaults (n)" holds
the platform rows in the same form. One sentence per row from a pure
`routingTargetSentence(target, names, t)` in
`apps/web/src/lib/inbox/routing-sentence.ts`. Each clause is one whole i18n key
under `inboxRules.defaults`; the function only joins clauses with "; ":

| Part         | Condition                                   | Text                                                                                                                                                                                                                    |
| ------------ | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Subject      | per detected type, two forms                | sentence-start: "A PDF", "An ISDOC invoice", "Any other file" (10 keys); mid-sentence: "a PDF", "an ISDOC invoice", "any other file" (10 keys); a token outside the ten detected types falls back to the "unknown" pair |
| Destination  | `documents`                                 | "{{subject}} goes to Documents as {{kind}}"                                                                                                                                                                             |
|              | `datasets`                                  | "{{subject}} goes to Datasets"                                                                                                                                                                                          |
|              | `discard`                                   | "{{subject}} is discarded"                                                                                                                                                                                              |
|              | `null`                                      | "{{subject}} waits in the inbox for a person to decide" (no more)                                                                                                                                                       |
| Entity       | `defaultLegalEntityId` set, entities loaded | appended " for {{entity}}"; unseen id: " for a hidden legal entity"                                                                                                                                                     |
| Confirmation | `auto = never`                              | "a person confirms every one"                                                                                                                                                                                           |
|              | `always`                                    | "it is filed without review"                                                                                                                                                                                            |
|              | `above_threshold`                           | "it is filed without review from {{percent}} confidence, otherwise a person confirms it"                                                                                                                                |
|              | auto asked, destination not `documents`     | "a person confirms every one, because only Documents files automatically"                                                                                                                                               |
|              | auto asked, invoice kind                    | "a person confirms every one until the ISDOC parser lands"                                                                                                                                                              |

The entity clause renders only once `useLegalEntities` has loaded, so a row
never shows the false "a hidden legal entity" while the fetch is still pending.

Example: "A PDF goes to Documents as Other for Henderson; a person confirms
every one." The two "auto asked" rows mirror the destination and invoice-kind
checks of `decideAutoRoute` in `apps/api/src/inbox/inbox-rule-repository.ts:217`
and `:225-234`, so a sentence never promises an auto-route the worker refuses on
those two grounds; the missing-field, issue and stale-owner waits are covered by
the lead line above, not by the per-row sentence. The percent uses
`Intl.NumberFormat` percent in the UI language. Required fields stay out of the
sentence.

**Edit flow.** With `manageOrganization` (owner) each row carries a ghost
"Change" button (accessible name "Change what happens to {{subject}}", the
mid-sentence subject form) and, on a changed row, "Reset to default". An admin
sees the sentences read only and one line "Only an owner can change the
defaults." Change opens today's Modal, retitled "Edit default", whose first line
is the live sentence built from the form. Fields: "Where it goes" (destination),
Document kind, Legal entity, "Confirmation" as a `RadioButtonGroup` of the three
auto policies, "Confidence (%)" only for above threshold: a whole number 0 to
100, prefilled `Math.round(autoThreshold * 100)`, sent as value `/ 100` into
`autoThreshold`, Required fields unchanged. No assignee field: the modal drops
the member picker and the sentence grammar carries no assignee clause. Save is
the same `PUT`, whose body keeps sending the stored `defaultAssigneeId`
unchanged; Reset the same `DELETE`.

**Quota.** New client component
`apps/web/src/app/(product)/[orgSlug]/settings/storage-quota.tsx`, the quota
tile of today's settings page moved as is (same `GET`/`PATCH .../inbox/settings`
calls, same `above_cap` handling), a section "Inbox storage" between the general
form and the leave section. `page.tsx` passes `canReadStorage = manageDocuments`
and `canManageOrganization`. The section renders only for `manageDocuments` (the
`GET` refuses a member) and is editable only with `manageOrganization`, the
`PATCH` guard: owner edits, admin reads. Success raises a toast, as the general
form does.

**Labels.** `inboxSettings.quota*` move to `settings.storage.*`; the target keys
move to `inboxRules.defaults.*`, including the destination and auto keys that
`lib/inbox/labels.ts` points at; the `inboxSettings` namespace is removed.

## Security

No new data path and no new write. Every call is an existing BFF route with its
existing capability. The members list is #75's route. Names only replace ids on
screen.

## Verification

- `routing-sentence.test.ts`: all ten platform defaults, each destination, each
  confirmation branch, the entity clause, unknown ids.
- `rules/page.test.tsx`: both sections; changed rows before the collapsed
  Defaults; owner sees Change and Reset, admin none; the modal preview follows
  the form; the `PUT` body carries `autoThreshold` 0.9 for 90 %; the confidence
  input prefills 29 for a stored `autoThreshold` 0.29; a failed targets read
  keeps the rules grid.
- `inbox/settings/page.test.tsx`: redirect with and without `organization`, the
  test awaiting the `async` page.
- `[orgSlug]/settings/page.test.tsx`: quota hidden for a member, read only for
  an admin, editable for an owner, the above-cap message.
- `breadcrumb-trail.test.ts`, `inbox/page.test.tsx` (no Settings entry),
  `apps/web/src/app/(product)/inbox/channels/page.test.tsx:202` (heading
  "Sources"), and a check that the item page destination labels render unchanged
  after the `labels.ts` key move (`labels.ts:49-66`, used at
  `inbox/[itemId]/page.tsx:806-807`).
- Proof `tests/operational/inbox.spec.ts`: the step "the pdf target gets the
  demo entity" moves to `/inbox/rules`: open Defaults, "Change what happens to a
  PDF", pick the entity, save, expect "A PDF goes to Documents as Other for
  {entity}; a person confirms every one." under Changed defaults. A new step:
  `/inbox/settings` lands on `/inbox/rules`; `/{slug}/settings` shows "Inbox
  storage" with the in-use line.
- `scripts/visual-gate.mjs`: drop `inbox-settings`, add `workspace-settings`
  (`/{slug}/settings`) at 1440; `inbox-rules` shot with Defaults open.
- `docs/application-routes.md`: the three page rows; `docs/configuration.md:43`:
  the quota location move.
- Gate: `pnpm check`, then `pnpm demo:inbox` for the proof.

## Lanes

One executor, three commits on `hlebtkachenko/inbox-settings-fold`:

1. `routing-sentence.ts` + test, rules page + test + scss, labels.
2. Quota component + org settings page + test, redirect page + test, inbox
   overflow, breadcrumb, channels heading, label moves.
3. Proof, visual gate, `docs/application-routes.md`.

`resources.ts` is touched by 1 and 2, so the commits run in order.

## Open questions

- Keep the redirect forever? Recommendation: yes; it is five lines and stops
  `/inbox/[itemId]` from swallowing old links.
- Should an admin edit the quota and the defaults? Recommendation: keep owner
  only (`manageOrganization`); widening is a later API and RLS change.
- Rename `/inbox/channels` to `/inbox/sources`? Recommendation: no; the wording
  changes, the route and the API keep "channels".

## Gate

Advisor (Opus 5.5, 2026-09-23): revise, folded in.

- The redirect stays permanently.
- Quota and defaults editing stays owner only; `/inbox/channels` is not renamed.
- Assignee is dropped from the defaults sentence and edit modal until intake
  applies it, a later API spec.
