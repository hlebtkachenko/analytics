# Product application layout

**Date:** 2026-09-14

## Problem

Signed-in pages share a minimal header with four links, and each page owns its
own `main`, breadcrumb, and content offsets. There is no rail, no global search,
notifications, help, settings, organization switcher, account panel, theme mode,
or toast host, and the shell decides which routes it wraps through a runtime
pathname allowlist rather than the filesystem. Product pages have no enforced
layout scaffolding.

## Scope

Add the full authenticated product frame: a Carbon UI Shell header (Afframe
Analytics brand, an Analytics area and a placeholder AI Assistant area, and the
global actions Search, Notifications, Help, Settings, Switcher, Account), a
collapsed icon rail with a cookie-pinned expanded state and an organization
section, one layout-owned `main`, small layout-owned breadcrumbs with overflow,
a global toast host, a light, dark, and system theme mode persisted in a cookie,
and a global search shell. Product routes move into `app/(product)`; URLs do not
change. `PageContainer` plus an ESLint rule enforce Grid, Column, FlexGrid, and
Stack scaffolding in product pages.

Not in scope: identity, invitation, and design-system routes; a real AI
Assistant route or behavior (it is a placeholder header item with no URL and no
reserved slug); real search, notification, help, or settings behavior; Carbon
conversion of the temporary organization and account pages; session data in the
shell; sample business data. The organization switcher lists the member's own
real memberships; every other panel body is placeholder copy.

## Design

`app/(product)/layout.tsx` (server) reads the rail cookie and renders the client
`ProductShell` around RSC children; `not-found.tsx` and `error.tsx` render
inside the shell; there is no `loading.tsx`. The shell owns
`Content id="main-content"`, the rail state, the exclusive panels, breadcrumbs
from `useSelectedLayoutSegments` (route groups filtered, the first segment
classified as a module or an organization slug), and the toast context.
`[orgSlug]/layout.tsx` registers the resolved organization into a client context
that feeds the breadcrumb label and the rail organization menu. The AI Assistant
area is a header item with no route; activating it raises a placeholder toast.
`DesignSystemProvider` gains a `mode` prop; the root layout reads `bap_theme`
and sets `data-carbon-theme` before hydration; `system` resolves through a
`prefers-color-scheme` rule and `matchMedia`. The icon facade grows to the
reviewed exports the shell uses. Cookies `bap_theme` and `bap_rail` are
validated with zod on read.

## Security

The preference cookies hold only enum values, are not secrets, and grant
nothing. The shell stays a navigation boundary, not authorization: pages and
handlers keep their own gates; the organization menu shows only the organization
the member gate resolved; the switcher lists memberships from the existing
Better Auth list endpoint. No token, id, email, or dataset value enters shell
state or logs. Slugs and pathnames choose presentation only.

## Verification

Unit: shell landmarks and labels, rail pin and cookie, exclusive panels,
breadcrumb trail and overflow, active-organization registration, toast API,
theme mode resolution and the hydration attribute, preference parsing,
reserved-route parity derived from the filesystem, the icon facade and AST
contract, and the ESLint rule tests. Operational: the updated navigation,
breadcrumb, throwaway-content, axe, reflow, and sign-out proofs. Gate:
per-workspace commands, then `pnpm check`, `pnpm test:integration`, and the
operational Playwright suite.

## Open questions

None outstanding. Deferred to follow-ups: the search backend, the notification
source, settings content, account profile display, a real AI Assistant route,
and Carbon conversion of the temporary pages.
