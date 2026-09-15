# Adding a product page

This is the complete checklist for adding an authenticated product page to
`apps/web`. Follow it in order. You do not need to read the shell source: the
shell is already wired, and every item below is a file you edit or create.

A "top-level page" here means a direct child segment of the `(product)` route
group, for example `/documents`. A nested page, for example
`/documents/[documentId]`, inherits everything its top-level segment registered
and only needs steps 1, 2, 8, 9, and 10.

## 1. Create the route inside the product route group

Create `apps/web/src/app/(product)/<segment>/page.tsx`. The group layout mounts
`ProductShell`, which owns the Carbon UI Shell header, the left icon rail, the
single `main-content` landmark, the breadcrumbs, the toast host, and the theme
mode. A page never adds its own header, navigation, `<main>`, or breadcrumb.

Add `'use client'` only when the page has interactive state. Nested routes are
ordinary App Router folders: `new/page.tsx`, `[documentId]/page.tsx`.

The group layout also enforces the browser session and redirects an
unauthenticated request to `/sign-in?next=<encoded path>`, so a page never reads
or checks the session itself.

## 2. Render the body inside PageContainer

```tsx
import PageContainer from '../../../components/page-container';

export default function Page() {
  return <PageContainer>{/* page content only */}</PageContainer>;
}
```

`PageContainer` is the only sanctioned content scaffold: a Carbon `Grid`,
`Column`, and `Stack`. The `bap/product-page-container` ESLint rule fails the
build for a product `page.tsx` or `not-found.tsx` that does not use it, and a
second rule bans inline `style=` attributes in product UI. Use a
`page.module.scss` CSS module and semantic Carbon tokens for any layout of your
own, and never raw colour values.

Import Carbon through `@bap/design-system/react` and icons through
`@bap/design-system/icons`. Importing `@carbon/react` or `@carbon/icons-react`
directly is a contract failure.

## 3. Register the rail destination

Add one entry to `railDestinations` in
`apps/web/src/components/shell/product-navigation.ts`:

```ts
{ href: '/documents', icon: Document, label: 'Documents', route: 'documents' },
```

The shell renders the rail, the active state, and the workspace section straight
from that array, so this single entry is the whole navigation change. Do not
edit `product-shell.tsx` to add a link.

Add the new label to the rail assertion in
`apps/web/src/components/shell/product-shell.test.tsx`.

## 4. Give the segment a breadcrumb label

Add a top-level segment to `moduleLabels` in
`apps/web/src/components/shell/breadcrumb-trail.ts`, for example
`documents: 'Documents'`. The layout derives the trail from the route segments
and shows ancestors only.

Child labels are scoped by the parent module, because the same segment means
different things under different modules: `/documents/new` reads `New document`
while `/organizations/new` reads `Create organization`. Name a child in
`childLabels` under its parent, not in `moduleLabels`:

```ts
const childLabels = {
  documents: { new: 'New document' },
};
```

A dynamic segment carries an opaque identifier, which must never reach the
trail. Give its parent an entry in `childFallbacks`, for example
`documents: 'Document'`, so an unknown child renders that label instead of the
raw value. Cover both in `breadcrumb-trail.test.ts`.

Optionally add one entry to `stubResults` in
`apps/web/src/components/shell/global-search.tsx` so the page is discoverable
from the header search.

## 5. Add the icon to the facade and to the icon contract

Add the named export to `packages/design-system/src/icons.ts`, keeping the list
alphabetical, and to `expectedNames` in
`packages/design-system/src/icons.test.tsx`. Add an export only with a real call
site: the facade is a reviewed set, not a passthrough.

Then update `apps/web/src/components/icon-contract.test.tsx`:

- `reviewedImports`: the file path and its imported icon names. The test scans
  every production `.ts` and `.tsx` file under `src`, so a navigation module
  counts too.
- `reviewedCallsites`: one tuple per `renderIcon` callsite, in source scan order
  (recursive directory order, then source order inside a file), as
  `[file, element, icon, visible label]`. Every callsite must keep visible text
  and must not be self-closing or icon-only.
- `reviewedIndirectIcons`: only when the icon comes from a navigation array
  rather than a local import.

## 6. Reserve the slug (top-level segments only)

A top-level segment must never collide with an organization slug. Change all
three in the same pull request:

- `reservedOrganizationSlugs` in `apps/web/src/lib/organizations/slug.ts`,
  appended at the end in the same order as the database check constraint.
- The literal list in `apps/web/src/lib/organizations/slug.test.ts`.
- A `{ "slug": "<segment>", "valid": false }` row in
  `tests/fixtures/organization-slugs.json`, the corpus shared with the database.

The database migration that appends the same value to
`organization_slug_reserved_check` belongs to the same change.

## 7. Add the data path: contract mirror, BFF function, fixed route

The browser never calls a service directly. Every read or write goes through one
fixed BFF route that mints a short-lived resource JWT for exactly 1 outbound
request.

1. Mirror the API contract with Zod in `apps/web/src/lib/<feature>/contract.ts`,
   with the comment
   `// Mirrors apps/api <feature> contract, which apps/web must not import.`
   Mirrors are `.strict()`, so an unexpected response shape is a failure, not a
   silent pass.
2. Add one exported function per endpoint to `apps/web/src/lib/auth/bff.ts`.
   Reuse `prepareApplicationCall` and `callApplicationJson`. Validate query
   parameters and rebuild the outbound query string from the parsed values:
   never forward a client query string verbatim. Validate request bodies with
   `readJsonBody` before a token is minted. A malformed identifier answers 404
   exactly like an invisible resource, so nothing can be enumerated.
3. Add the route file under
   `apps/web/src/app/api/bff/application/organizations/[organizationId]/...`
   that awaits `context.params`, calls `getAuth()`, and delegates to the bff
   function. Route files hold no logic.
4. Add path builders and any mutation helper to
   `apps/web/src/lib/<feature>/client.ts` for the page to use.

A page that works inside one organization takes the membership list from
`useOrganizationSelection` in
`apps/web/src/lib/organizations/use-organization-selection.ts`, which honours
`?organization=<slug>`, and reads the capability gate with
`organizationAccessSchema` from `apps/web/src/lib/datasets/client.ts`. Do not
mirror either of those inline.

## 8. Add the strings

Every visible string lives in the `en-US` `translation` object in
`apps/web/src/i18n/resources.ts`, under one namespace per feature, keys sorted
alphabetically. Pages read them with `useTranslation()`. No literal user-facing
text in a component.

Raise transient feedback with `useToast()` from
`apps/web/src/components/shell/toast.tsx`, and persistent failures with a Carbon
`InlineNotification`.

## 9. Add the tests

- `page.test.tsx` next to each page, rendering it inside `I18nProvider` (and
  `ToastProvider` when the page raises toasts) with a `vi.stubGlobal('fetch')`
  router that answers each path with the shape its contract promises.
- Mock `next/navigation` when the page uses `useRouter`, `useParams`, or
  `useSearchParams`.
- Add BFF cases to `apps/web/src/lib/auth/bff.test.ts` for at least the list
  read and the primary write: the rebuilt outbound URL, the contract defaults,
  and a refused malformed query or body with no outbound call.
- Use neutral placeholders such as `Placeholder Supplier`. Never add sample
  customer, employee, company, transaction, or analytics data.

## 10. Document the routes

Add the page to the browser page table in
[the route contract](application-routes.md), add one row per new BFF shape to
the BFF table, and update the fixed BFF route count in the sentence above that
table. A top-level page also belongs in the rail table.

## 11. Run the gate

```bash
pnpm --filter @bap/design-system test
pnpm --filter @bap/web lint
pnpm --filter @bap/web typecheck
pnpm --filter @bap/web test
pnpm --filter @bap/web build
```

Then `pnpm check` before pushing.
