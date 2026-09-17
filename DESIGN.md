# BAP Design

Carbon Design System is the sole BAP design system. The repository integrates
the official Carbon React library, its Sass foundation, IBM Plex font families,
Carbon icons and pictograms, Carbon Charts, and Carbon accessibility guidance.
It includes a generic product slice for dataset upload, listing, row browsing,
CSV/XLSX export, chat, and chart rendering. Domain-specific analytics,
dashboards, analytical metrics, and business workflows remain deferred.

The implementation lives in `@bap/design-system`. Product code must consume its
public entrypoints and semantic Carbon tokens instead of copying Carbon source,
hard-coding palette values, or introducing another component library. See
[the Carbon integration guide](docs/design-system/carbon.md) for the contract,
[the offline knowledge base](docs/design-system/knowledge-base/README.md) for
design and implementation guidance, and the local Storybook workbench for the
pinned executable surface before adding user interfaces.

Run `pnpm design-system:dev` to inspect individual components, supported
variants, status warnings, themes, feature flags, tokens, layouts, patterns,
charts, diagrams, icons, and pictograms. The committed generated catalog and
closed-world source mappings make the same release discoverable without access
to Carbon websites.

Application icons come from the exact curated 29-export
`@bap/design-system/icons` entrypoint. Add a named export only with a real use
on an existing Carbon page. Prefer the Carbon component's icon prop, retain
visible action text, keep repeated glyphs decorative to assistive technology,
and use only Carbon's 16, 20, 24, or 32px artboards. The executable workbench
renders those 29 glyphs and all 1,575 pictograms; the generated catalog alone
retains the exhaustive upstream icon inventory. Product applications must never
import `@carbon/icons-react` directly.

Foundation identity and access surfaces use official Carbon form, feedback,
layout, and content primitives through `@bap/design-system`. They establish no
dashboard or analytics visual design. Do not add another component system,
utility CSS framework, raw palette values, or copied Carbon source.

Authenticated `app/(product)` routes share a Carbon UI Shell product shell: a
header branded "Afframe Analytics" with single-purpose panels for search,
notifications, help, settings, workspace switching, and account, over a
pinned-persistable left icon rail for Workspaces, Datasets, Documents, and
Account, and a workspace section, rendered from the shell's `railDestinations`
array. Identity and invitation routes remain outside that shell. The layout owns
the single `main-content` landmark and renders small Carbon breadcrumbs for
subordinate views, including the inline dataset view. The `/account` area is now
Carbon: profile, security, and preferences pages plus the access diagnostic at
`/account/access`, each rendered inside `PageContainer`. The `/organizations`
list and create pages and the `/[orgSlug]` landing, `/[orgSlug]/entities`,
`/[orgSlug]/members`, and `/[orgSlug]/settings` pages are now Carbon; converting
the remaining page content to Carbon is future work.

Every product page renders its content inside the shared `PageContainer`
scaffold; the `bap/product-page-container` ESLint rule enforces it and bans
inline layout styles, so pages compose inside the shell and never hand-roll
layout. See [Building a product page](docs/development.md).
