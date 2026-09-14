# Application and HTTP Routes

This document is the current route, state, and discoverability contract for the
web application. It describes browser pages separately from browser-callable
HTTP routes and internal operational endpoints.

## Application shell

The `app/(product)` route group wraps Access, Organizations, Datasets, Account,
and member-visible organization routes in a shared server layout that renders
the client `ProductShell`: a Carbon UI Shell header branded "Afframe Analytics",
over a left icon rail, with two header areas, "Analytics" (active) and a
placeholder "AI Assistant" that has no route yet and raises a toast on click.
The header's global actions, in order, are Search, Notifications, Help,
Settings, a Workspaces switcher listing the member's real organizations, and
Account; each opens one single-purpose header panel at a time, and the Account
panel holds the light/dark/system theme control and sign out.

The left icon rail (Carbon `SideNav` with `isRail`) is the whole-app navigation
to these four top-level destinations, plus a workspace section (Members,
Entities, Settings) shown only while an organization is active:

| Label         | Route            | Purpose                                      |
| ------------- | ---------------- | -------------------------------------------- |
| Access        | `/access`        | Compare application and reporting access     |
| Organizations | `/organizations` | List, create, and enter organizations        |
| Datasets      | `/datasets`      | Ingest, list, inspect, export, and chat      |
| Account       | `/account`       | Sign out, change password, or delete account |

The header hamburger toggles a pinned expanded rail, persisted in the `bap_rail`
cookie. The rail's `aria-label` is "Side navigation", and the hamburger button
label is "Expand side navigation" or "Collapse side navigation".

The shell itself is a navigation boundary, not an authorization decision. Pages
and HTTP handlers still verify the session, email state, membership, role,
capability, and row-level policy appropriate to each operation. Identity,
invitation, and design-system reference routes render without the shell.

The layout owns the single `main-content` landmark and renders small
(`size="sm"`) Carbon breadcrumbs derived from the route segments, collapsing the
middle into an `OverflowMenu` when the trail exceeds five entries. Organization
descendants use these layout-owned Carbon breadcrumbs; their page content is
deliberately temporary. An open dataset is an inline state of `/datasets`, not a
separate URL, and its breadcrumb entry returns to the list. Top-level pages and
linear identity tasks do not add breadcrumbs.

The `bap_theme` and `bap_rail` preference cookies hold only enum values, are not
secrets, and are validated with zod on read.

## Browser pages

| Route                        | Entry and state contract                                                                                                                                                                                                                                               | Discoverability and current actions                                                                                                                                                                                                                                                                                | Presentation state      |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------- |
| `/`                          | Redirects to `/organizations`.                                                                                                                                                                                                                                         | Direct entry only.                                                                                                                                                                                                                                                                                                 | Redirect                |
| `/sign-in`                   | Public. Password sign-in requires a verified account. A two-factor response continues to `/sign-in/two-factor`; ordinary success continues to `/access`.                                                                                                               | Links to password recovery. The create-account link appears only while public sign-up is enabled.                                                                                                                                                                                                                  | Carbon identity page    |
| `/sign-in/two-factor`        | Public route whose submit action requires the signed pending-challenge cookie established by password sign-in. Success continues to `/access`.                                                                                                                         | Reached from `/sign-in` when Better Auth reports a second-factor challenge.                                                                                                                                                                                                                                        | Carbon identity page    |
| `/sign-up`                   | Public page. The form remains visible when public sign-up is off, but only a pending, unexpired invitation for the submitted email can bypass that default-off gate. Success stays sessionless until email verification.                                               | Linked from `/sign-in` only while public sign-up is on, and always offered from a signed-out invitation page for an invited recipient.                                                                                                                                                                             | Carbon identity page    |
| `/forgot-password`           | Public. Every submitted address receives the same visible result.                                                                                                                                                                                                      | Linked from `/sign-in`; links back to sign-in.                                                                                                                                                                                                                                                                     | Carbon identity page    |
| `/reset-password`            | Public route, but the form appears only while the short-lived, path-scoped reset capability cookie is valid. The token is not exposed to the form.                                                                                                                     | Reached through the password-reset mail callback; links to request a new reset.                                                                                                                                                                                                                                    | Carbon identity page    |
| `/activate`                  | Public verification landing. A verified session redirects to `/welcome`; invalid and consumed-link states show generic recovery guidance without exposing a token.                                                                                                     | Reached through verification mail; recovery links to sign-in.                                                                                                                                                                                                                                                      | Carbon identity page    |
| `/welcome`                   | Requires a browser session and otherwise redirects to `/sign-in`.                                                                                                                                                                                                      | Reached after successful activation; links to `/access`.                                                                                                                                                                                                                                                           | Carbon identity page    |
| `/invitation/[invitationId]` | A signed-out render performs no invitation lookup and shows only generic guidance. A signed-in invited recipient can load the organization name and role, then accept with the verified matching account.                                                              | Reached through invitation mail. Its signed-out links are fixed `/sign-in` and `/sign-up` URLs and carry no invitation id, email, or token.                                                                                                                                                                        | Carbon task page        |
| `/access`                    | Usable data requires a verified session and at least 1 organization. It selects an organization and resolves independent application and reporting access contracts. Empty and failure states are explicit.                                                            | Primary rail link. Shows the eight capabilities and `entityScope`. Member and entity access management link to `/{orgSlug}/members`; entity management links to `/{orgSlug}/entities`; upload links to the selected `/datasets` state. The general assistant is visibly unavailable, not an inert control.         | Carbon application page |
| `/organizations`             | Requires a verified session and otherwise redirects to `/sign-in`. Lists all current memberships and an explicit empty state.                                                                                                                                          | Primary rail link; links to organization creation and each `/{orgSlug}` page.                                                                                                                                                                                                                                      | Temporary semantic HTML |
| `/organizations/new`         | Requires a verified session. Shows remaining creator quota; quota 0 replaces the form with an unavailable message.                                                                                                                                                     | Linked from `/organizations`; breadcrumb returns there. Successful creation continues to the new `/{orgSlug}` route.                                                                                                                                                                                               | Temporary semantic HTML |
| `/[orgSlug]`                 | Requires a verified member. Malformed, unknown, nonmember, and failed resolution states all return the same 404.                                                                                                                                                       | Linked from `/organizations`; breadcrumb returns there; links to members, entities, and settings.                                                                                                                                                                                                                  | Temporary semantic HTML |
| `/[orgSlug]/members`         | Requires a verified member. Only owners can invite, assign a role, remove a member, or edit an admin's or a member's entity scope; Better Auth's explicit access control enforces the same restriction. Admins and members see lists without management forms.         | Linked from the organization page and from Access when `manageMembers` is true. Breadcrumb is Organizations, organization, Members.                                                                                                                                                                                | Temporary semantic HTML |
| `/[orgSlug]/entities`        | Requires a verified member. Owners, and admins holding `createEntities`/`updateEntities`, can add or edit a `company` or `sole_trader` legal entity with an optional registration number; only an owner can delete one. Members see the list without management forms. | Linked from the organization page and from Access when `createEntities`, `updateEntities`, or `manageEntityAccess` is true. Breadcrumb is Organizations, organization, Entities.                                                                                                                                   | Temporary semantic HTML |
| `/[orgSlug]/settings`        | Requires a verified member. Only owners can change name and slug; admins and members receive a read-only denial message. A slug change continues at the new URL.                                                                                                       | Linked from the organization page. Breadcrumb is Organizations, organization, Settings.                                                                                                                                                                                                                            | Temporary semantic HTML |
| `/datasets`                  | A verified session selects the first membership or the organization named by `?organization=<slug>`. It separately reports organization, access, and dataset-list failures. An organization with no data shows an explicit empty state.                                | Primary rail link and Access upload target. Capable users upload CSV/XLSX into a chosen legal entity, switch the page's entity scope between all entities or one, open paged rows and charts inline, download streaming CSV/XLSX, and use dataset-grounded chat. The inline detail breadcrumb returns to the list. | Carbon application page |
| `/account`                   | Requires a session and otherwise redirects to `/sign-in`. Supports sign-out, password change, and deletion; a sole organization owner must delegate ownership first.                                                                                                   | Primary rail link.                                                                                                                                                                                                                                                                                                 | Temporary semantic HTML |
| `/design-system`             | Public implementation reference with no application session requirement.                                                                                                                                                                                               | Direct route for development/reference use; excluded from the application shell.                                                                                                                                                                                                                                   | Carbon reference page   |

The six temporary organization pages are `/organizations`, `/organizations/new`,
`/[orgSlug]`, `/[orgSlug]/members`, `/[orgSlug]/entities`, and
`/[orgSlug]/settings`. Together with `/account`, they intentionally use plain
semantic HTML and no page-level Carbon, CSS, or icon imports. Their durable
authorization, slug-resolution, server-action, and shell boundaries are not
temporary.

## Browser-callable HTTP routes

Better Auth owns `GET` and `POST /api/auth/*`. BAP applies its public route
gate, sign-up switch and invitation exception, rate limits, disabled-path
policy, and verification-delivery boundary before or around Better Auth
dispatch. The complete endpoint inventory is in
[authentication](authentication.md).

The browser can call exactly 12 fixed BFF-to-service route shapes. Each requires
a verified opaque-cookie session, mints a short-lived in-memory resource JWT for
1 outbound request, targets a compile-time internal origin, and validates the
response before returning it. There is no catch-all service proxy.

| Browser route                                                                                    | Internal target                     | Result                                                                                                      |
| ------------------------------------------------------------------------------------------------ | ----------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `GET /api/bff/application/organizations/[organizationId]/access`                                 | Application API organization access | Allow-listed role, capabilities, and `entityScope`                                                          |
| `GET /api/bff/application/organizations/[organizationId]/legal-entities`                         | Application API legal-entity list   | Legal entities in the caller's scope                                                                        |
| `POST /api/bff/application/organizations/[organizationId]/legal-entities`                        | Application API legal-entity create | Needs `createEntities`; created entity                                                                      |
| `PATCH /api/bff/application/organizations/[organizationId]/legal-entities/[legalEntityId]`       | Application API legal-entity update | Needs `updateEntities` and scope                                                                            |
| `DELETE /api/bff/application/organizations/[organizationId]/legal-entities/[legalEntityId]`      | Application API legal-entity delete | Needs `deleteEntities`; owner only                                                                          |
| `GET /api/bff/application/organizations/[organizationId]/members/[userId]/entity-scope`          | Application API entity-scope read   | Needs `manageEntityAccess`; owner only                                                                      |
| `PUT /api/bff/application/organizations/[organizationId]/members/[userId]/entity-scope`          | Application API entity-scope update | Needs `manageEntityAccess`; rejects an owner target                                                         |
| `POST /api/bff/application/organizations/[organizationId]/uploads`                               | Application API upload              | Streamed CSV/XLSX acceptance and upload id; multipart field `legalEntityId` must be in scope                |
| `GET /api/bff/application/organizations/[organizationId]/datasets?legalEntityId=`                | Application API dataset list        | Visible domain-free dataset summaries, each with `legalEntityId`, filtered by scope and the optional entity |
| `GET /api/bff/application/organizations/[organizationId]/datasets/[datasetId]/rows`              | Application API paged rows          | Validated columns, rows, and next cursor; 404 when the dataset's entity is out of scope                     |
| `GET /api/bff/application/organizations/[organizationId]/datasets/[datasetId]/export?format=...` | Application API streaming export    | CSV or XLSX attachment with BAP-owned name; 404 when the dataset's entity is out of scope                   |
| `GET /api/bff/reporting/organizations/[organizationId]/access`                                   | Reporting API organization access   | Allow-listed role, capabilities, and `entityScope`                                                          |

`POST /api/chat` is a web-local streaming route, not a generic proxy. It
requires a verified session and the selected organization's `useAi` capability.
If a dataset id is supplied, the route resolves the dataset through the same
list and row BFF boundaries before reading the provider credential. It sends
bounded metadata and columns to the selected model, never stored cells.

## Caddy and operational routes

Caddy is the only public container. Requests for the configured host are limited
to 25 MB and proxied to the web application except for the operational paths it
blocks before proxying.

| Public request                    | Result                                                 |
| --------------------------------- | ------------------------------------------------------ |
| `GET /health`                     | Proxied to web; JSON health response                   |
| `/ready`, `/ready/*`              | Caddy returns 404; never reaches web readiness         |
| `/metrics`, `/metrics/*`          | Caddy returns 404; never reaches web Prometheus output |
| Other configured-host page or API | Proxied to the web application                         |
| Request for an unmatched host     | Catch-all site returns 421                             |

Web, application API, reporting API, and worker health, readiness, and metrics
endpoints are private service-network surfaces. The 2 Nest APIs and worker are
never published through Caddy. PostgreSQL is loopback-only in development. The
optional Mailpit overlay publishes only its narrow inspection companion on
loopback: `GET /readyz` and `GET /api/v1/search`; Caddy has no Mailpit route.
