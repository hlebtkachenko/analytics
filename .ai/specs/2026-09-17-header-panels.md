# Header panels: real search, trimmed help, real account panel, placeholders removed

**Date:** 2026-09-17

## Problem

The product shell header carries four placeholder surfaces. Global search is a
hardcoded `stubResults` list. The help panel is four buttons that all raise a
"Coming soon" toast. The notifications panel and the settings panel say a
feature "arrives with the first product module". The account panel shows "Your
account" with three identical `/account` links and no real identity. An "AI
Assistant" header area raises a "coming soon" toast. All violate the
no-placeholder rule: search, workspaces, entities, the docs link, the app
version, feedback, and the signed-in user's identity and role are all real data
the shell can show today.

## Scope

- Search made real: a client index built on panel open from data the user
  already sees, keyboard-navigable, with an empty state only for a non-matching
  query.
- Help panel keeps only real items: Documentation (public GitHub docs URL),
  About (version), Send feedback (mailto, hidden when its env var is unset).
- Account panel made real: initials, name, email, role in the active workspace,
  links to `/account`, `/account/security`, `/account/preferences`, the theme
  radio (kept), sign out (kept).
- Remove the notifications panel and its header action. Remove the settings
  panel and its header action. Remove the AI Assistant header area and its
  toast.
- Facade cleanup, i18n keys, and doc updates for the removals.
- Out of scope: new endpoints, notification/settings features, a "What's new"
  item, a shortcuts modal, legal/community links, per-result ranking or history.

## Design

Files modified: `components/shell/header-panels.tsx`, `product-shell.tsx`,
`product-navigation.ts`, `global-search.tsx`, plus their tests
(`product-shell.test.tsx`, and search/panel tests added below);
`components/icon-contract.test.tsx`; `packages/design-system/src/icons.ts` and
`icons.test.tsx`; `lib/auth/client.ts` (only if a session hook must be
exported); `i18n/resources.ts`; `DESIGN.md`, `ARCHITECTURE.md`,
`docs/application-routes.md`, `docs/configuration.md`.

- Header actions after this change, in order: Search, Help, Account, Workspaces
  (switcher). Notifications and Settings actions and their `PanelId` members are
  removed; `PanelId` becomes `account | help | search | switcher`.
- Search index shape:
  `{ label: string; href: string; kind: 'page' | 'workspace' | 'entity' }`.
  Built client-side in `global-search.tsx` when the panel opens (search already
  mounts only while open): pages from `railDestinations`
  (+`workspaceSectionItems` prefixed with the active workspace slug when one is
  active), workspaces from `GET /api/auth/organization/list` (kind `workspace`,
  href `/<slug>`), and, only when a workspace is active, its legal entities via
  `getJson(legalEntitiesPath(id))` where `id` is the active workspace's id from
  that same list (matched by the active slug). Both fetches use
  `AbortController` and fail soft to the pages-only index. Filtering matches the
  query against `label` (case-insensitive, substring); grouping is by `kind`.
  Keyboard: arrow up/down move a highlighted index across the flat filtered
  list, Enter navigates (`router.push(href)` then `onClose`), Escape closes
  (already wired). The empty line renders only when the query is non-empty and
  nothing matches (a real state, not a placeholder).
- Active workspace: the shell already exposes `useActiveOrganization()`
  (`{ name, role, slug }` or undefined). Search reads it via a prop from
  `ShellChrome`; entities load only when it is defined.
- Help panel: Documentation is a `Link`/anchor to
  `https://github.com/hlebtkachenko/analytics/tree/main/docs` (the `origin`
  remote's docs folder). About shows the version from `apps/web/package.json`
  (imported build-time constant; no commit SHA, because no `NEXT_PUBLIC_*` build
  arg or Dockerfile `ARG` exists in this repo today). Send feedback is a
  `mailto:` anchor built from `process.env.NEXT_PUBLIC_FEEDBACK_EMAIL`; the item
  is omitted entirely when the variable is unset. No toast helper remains.
- Account panel: identity from the Better Auth session
  (`authClient.useSession()` `data.user` name/email; initials derived from name,
  else email). Role from `useActiveOrganization()` (shown only when a workspace
  is active). Three links: `/account`, `/account/security`,
  `/account/preferences`. Theme radio and sign out unchanged.
- Icon facade: `Notification` and `Settings` become orphaned (no other repo call
  site; verified by grep). Remove both from
  `packages/design-system/src/icons.ts` and from `icons.test.tsx`
  `expectedNames`, per DESIGN.md's "exports only with a real call site" rule.
  `Search`, `Help`, `Switcher`, `UserAvatar`, `Close`, `Asleep`, `Light`,
  `Logout` stay (still used).
- i18n: header strings are currently hardcoded. Add a `shell` namespace grouping
  search (label, placeholder, empty, group labels), help (documentation, about
  with `{{version}}`, feedback), account (links, roles, signOut, theme). Removed
  strings: the notifications, settings, "What's new", and AI Assistant labels
  (delete `ASSISTANT_AREA_LABEL` from `product-navigation.ts`).
- `docs/configuration.md`: add `NEXT_PUBLIC_FEEDBACK_EMAIL` (public, optional;
  the feedback item hides when unset) to the public inputs table.

## Security

The search index is built only from data the user already sees: their own
workspace list (Better Auth, session-derived) and the active workspace's legal
entities through the existing BFF (`getJson`, resource JWT minted server-side, a
401 bounces to sign-in). No new endpoint, no new contract, no id in a URL query.
`NEXT_PUBLIC_FEEDBACK_EMAIL` is a public mailto address, not a secret, and is
the only new env input. The docs URL is a public repository link. Sign out still
clears the session client-side and redirects.

## Verification

`product-shell.test.tsx`: Search, Help, Account, Workspaces actions present;
Notifications and Settings actions absent; no AI Assistant area. `global-search`
test: index built from mocked `organization/list` and `legalEntities` calls
(pages + workspaces + entities), query filtering, arrow+Enter navigation, empty
state only on a non-matching query, pages-only fallback when fetches reject.
Help panel test: About shows the version; Documentation href is the docs URL;
feedback item hidden when `NEXT_PUBLIC_FEEDBACK_EMAIL` is unset and shown as a
`mailto:` when set. Account panel test: three links resolve, role shown from the
active organization and hidden without one. `icon-contract.test.tsx` and
`icons.test.tsx` updated (Notification/Settings dropped from `reviewedImports`,
`reviewedCallsites`, `expectedNames`). Gate (fast): `pnpm --filter @bap/web`
`lint`, `typecheck`, `test`, `format:check`; and, because the facade changes,
`pnpm --filter @bap/design-system test`.

## Open questions

1. About version: import `apps/web/package.json` version build-time (currently
   `0.0.0`) versus a generated constant. Assume the direct import unless the web
   build's JSON-import settings forbid it.
2. Feedback env var name: `NEXT_PUBLIC_FEEDBACK_EMAIL` assumed; confirm no
   existing config prefers another name.

## Corrections (2026-09-17)

Advisor-verified adjustments applied during implementation, superseding the
matching lines above:

1. No `NEXT_PUBLIC_*`: the feedback address is read server-side as
   `BAP_FEEDBACK_EMAIL` in `apps/web/src/app/(product)/layout.tsx` and passed as
   the `feedbackEmail` prop next to `version`. Documented in the
   `docs/configuration.md` main environment table, not the public inputs table.
2. `ActiveOrganizationValue` gains an `id`. `[orgSlug]/layout.tsx` passes it and
   the search entity index loads by that id, not by slug.
3. Identity comes from the server: `(product)/layout.tsx` passes
   `user { name, email }`; the shell never calls `authClient.useSession()`.
4. The entities BFF list is `ResourceJwtGuard` and scope-filtered, so a
   restricted member gets a filtered list, never a 403.
5. `global-search.tsx` reuses `organizationsSchema` from `header-panels.tsx` and
   `common.signOut`; the external docs link uses `rel="noreferrer"` and
   `target="_blank"`; the version is a server-side `package.json` import
   (`resolveJsonModule` is on).
6. Header action order becomes Search, Help, Account, Workspaces.
7. The application icon facade drops to 27 exports (Notification and Settings
   removed); every count reference is updated.
8. The AI Assistant header item, its toast, and the now-dead
   `access.useAiUnavailable` string are removed.
