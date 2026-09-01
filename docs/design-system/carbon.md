# Carbon Integration

The complete offline handbook starts at the
[Carbon knowledge base](knowledge-base/README.md). Use that handbook for design,
component, pattern, chart, accessibility, contribution, and upgrade guidance.
This page records the package integration contract only.

## Scope

`@bap/design-system` is the only BAP design-system package. It adapts the
official Carbon packages rather than copying their source or creating product
components. It contains no business concepts, layouts, synthetic analytics, or
brand overrides.

Current exact versions are maintained in the workspace catalog:

- `@carbon/react` `1.115.0`
- `@carbon/icons-react` `11.87.0`
- `@carbon/pictograms-react` `11.109.0`
- `@carbon/charts-react` `1.27.18`
- `@ibm/plex-sans` `1.1.0`
- `@ibm/plex-mono` `1.1.0`
- `@ibm/plex-serif` `2.0.0`
- `sass` `1.103.1`

Carbon supports React 19. The package declares React, React DOM, and React-is as
peers so an application provides one compatible React runtime.

## Public entrypoints

| Entrypoint                             | Boundary             | Purpose                                                                |
| -------------------------------------- | -------------------- | ---------------------------------------------------------------------- |
| `@bap/design-system`                   | Server-safe, compact | Semantic metadata and type exports only                                |
| `@bap/design-system/catalog`           | Server-safe, heavy   | Exhaustive generated API, declarations, token, flag, and Sass metadata |
| `@bap/design-system/component-catalog` | Server-safe, compact | Renderable exports, status, parents, aliases, and controls             |
| `@bap/design-system/react`             | Client               | Full official `@carbon/react` public API                               |
| `@bap/design-system/icons`             | Client               | Exact 18 Carbon icons used by reviewed BAP application actions         |
| `@bap/design-system/pictograms`        | Client               | Complete 1,575-export Carbon React pictogram public API                |
| `@bap/design-system/charts`            | Client               | Full official `@carbon/charts-react` API plus `ChartFrame`             |
| `@bap/design-system/theme`             | Client               | `DesignSystemProvider`                                                 |
| `@bap/design-system/tokens`            | Server-safe, compact | Semantic inventory and theme types                                     |
| `@bap/design-system/styles.scss`       | Global               | Carbon CSS plus BAP root theme selectors                               |
| `@bap/design-system/fonts.scss`        | Global               | Selected self-hosted IBM Plex faces                                    |
| `@bap/design-system/charts.css`        | Global               | Official Carbon Charts styles                                          |

The React, pictogram, and chart facades use `export *` and exact-match their
installed public APIs. The icon facade is intentionally different: it names only
the Carbon icons used by reviewed BAP application actions. The pinned React
package exposes a 367-key ESM namespace and a 365-key CommonJS namespace. The
catalog records module modes separately and retains the complete upstream icon
inventory independently of the curated product facade. It classifies recursive
namespace members and exact-compares every full facade with its matching
upstream mode. Renderable API metadata resolves props from exported types, call
signatures, construct signatures, and class instances, including aliased and
namespace exports. It separates Carbon-owned fields from inherited React and DOM
fields and records portable declaration paths. Every current renderable has a
public props record. The two Overflow Menu V2 aliases are explicitly reviewed
upstream `any` props; there are no genuine no-props renderables in the pinned
release. It also records the public declaration surfaces of
`@carbon/charts-react` and `@carbon/charts`, including type-only exports,
aliases, declaration paths, property types, and literal option controls. The
generated catalog, not a manual family list or count, is the exhaustive API
reference.

Use the client facades from a Client Component. Server Components may import
metadata from the root, `tokens`, or `component-catalog` entrypoints, then pass
serializable props to client leaf components. Import the full `catalog`
entrypoint only in tooling or an intentionally lazy reference view. The web app
opts into workspace transpilation through `transpilePackages`.

## Themes and colors

The supported Carbon themes are `white`, `g10`, `g90`, and `g100`. The root web
layout renders `data-carbon-theme="white"` before hydration. The client
`DesignSystemProvider` keeps `document.documentElement.dataset.carbonTheme` in
sync if its `theme` prop changes and also sets Carbon `GlobalTheme` context.

Use role-based Carbon color tokens, never palette hex values in BAP source. The
semantic metadata records Carbon's background, layer, field, border, text, link,
icon, button, support, focus, skeleton, highlight, interactive, and toggle token
groups. Use Carbon `Theme` only for intentional inline theme zones and `Layer`
for nested component surfaces.

## Sass token contract

The package forwards Carbon Sass modules without copied token values:

- `tokens/colors.scss`
- `tokens/grid.scss`
- `tokens/layout.scss`
- `tokens/motion.scss`
- `tokens/spacing.scss`
- `tokens/theme.scss`
- `tokens/themes.scss`
- `tokens/type.scss`

Each category retains official Carbon names. The combined `tokens.scss` also
forwards every category with a category prefix, such as `color-*`, `theme-*`,
and `type-*`, so identically named upstream variables remain available instead
of being omitted. Every exported Sass entrypoint is compiled by the package
build check. The Sass check supplies pnpm's virtual-hoisted module path because
Carbon's Sass imports span its published package graph.

The global stylesheet configures Carbon's own `$css--font-face` flag to `false`
before importing Carbon, preventing the aggregate Plex package from emitting
unselected fonts. It then emits CSS custom properties for all four themes.

## Typography, layout, and motion

Carbon uses IBM Plex Sans, Mono, and Serif. BAP self-hosts Carbon's complete
default face matrix for all three families: light, regular, and semibold
weights; normal and italic styles; and the Cyrillic, Pi, Latin3, Latin2, and
Latin1 subsets. The production build emits exactly 90 WOFF2 assets. The facade
owns the font-face URLs while using Carbon's official family-specific Unicode
maps, which keeps pnpm and Next resolution deterministic. The official
per-family Plex packages are direct dependencies; the larger aggregate package
remains transitive to Carbon styles and is not used for BAP font faces.

Use the Carbon 2x Grid through `Grid` and `Column`. Its mini-unit is 8px and the
standard breakpoints are 320, 672, 1056, 1312, and 1584px. The spacing metadata
exposes the official 2, 4, 8, 12, 16, 24, 32, 40, 48, 64, 80, 96, and 160px
scale. Typography metadata names Carbon's productive, expressive, heading, body,
label, code, helper, and legal styles.

Use Carbon's productive or expressive motion tokens rather than custom easing.
The static duration tokens are 70, 110, 150, 240, 400, and 700ms. Respect user
reduced-motion preferences whenever adding motion beyond component behavior.

## Components, icons, and charts

The React facade supplies the installed Carbon public API. Stable, preview,
unstable, deprecated, feature-flagged, compound, hook, context, utility, and
constant surfaces are separate catalog classifications. A source folder or
upstream story is not proof that a name is a public root export. See the
[component guide](knowledge-base/05-components.md) and generated workbench.

The icon facade exports exactly the 18 reviewed application glyphs. Use named
imports and Carbon's approved 16, 20, 24, or 32px artboards. Prefer a Carbon
component's `renderIcon` or equivalent icon prop so glyphs inherit the
monochrome text color and remain center-aligned. Keep visible action text where
it is needed. A glyph that repeats that label stays `aria-hidden` and never
receives focus; a future icon-only control must use the Carbon tooltip/label API
and a 44px touch target. Add no facade export without a real application call
site, and never import `@carbon/icons-react` from an application.

The pictogram facade is separate from icons and exports all 1,575 installed
Carbon React pictograms. Pictograms communicate broader concepts and are not
compact control glyphs. The workbench virtualizes the complete 1,575-pictogram
inventory and the exact 18-icon application set. The generated catalog, rather
than the executable icon facade or explorer, preserves exhaustive metadata for
the complete installed upstream icon inventory.

The charts facade exports the 25 standard React chart components: area, stacked
area, grouped/simple/stacked bar, boxplot, bubble, bullet, choropleth, donut,
gauge, histogram, line, lollipop, pie, scatter, meter, radar, combo, tree,
treemap, circle pack, word cloud, alluvial, and heatmap. It also exports
`ExperimentalChoroplethChart` and all diagram primitives, including CardNode
parts, Edge, ShapeNode, and marker exports. The metadata and tests distinguish
these categories and assert every chart-related name against the pinned package.
The local workbench lazily exposes both chart declaration inventories, so
`ChartOptions`, event, data, configuration, and type-only contracts remain
searchable offline alongside runtime chart components.

`ChartFrame` is the only BAP-owned visual utility. It wraps a caller-supplied
chart with a title, optional description, and equivalent Carbon table. Supply
descriptive chart titles, an `accessibility.svgAriaLabel` option, localized
labels, and an equivalent table for every chart. Its table supports a
caller-provided missing-value label and column header scope. Do not create a
dashboard, KPI model, chart data, or chart-color assignment without product
requirements.

## Global stylesheet order

Import the three global assets once, in the app root layout, in this order:

1. `@bap/design-system/styles.scss`
2. `@bap/design-system/fonts.scss`
3. `@bap/design-system/charts.css`

The base stylesheet must precede charts. Do not import these global styles from
leaf components.

## Telemetry, licenses, and upgrades

Carbon and Plex packages contain IBM Telemetry postinstall scripts. The pnpm
`allowBuilds` policy blocks those lifecycle scripts for every installation.
Repository build scripts and every Docker stage additionally set
`IBM_TELEMETRY_DISABLED=true`. The web and root scripts set
`NEXT_TELEMETRY_DISABLED=1`. The workbench config disables Storybook telemetry,
and every Storybook command plus CI sets `STORYBOOK_DISABLE_TELEMETRY=1`.

Carbon React, Carbon Charts, Carbon Icons, and Carbon Pictograms are Apache-2.0.
IBM Plex is OFL-1.1. See `THIRD_PARTY_NOTICES.md`. When upgrading, update the
exact catalog versions and lockfile together, run the complete gate, review
Carbon release notes, verify facade inventory tests, Sass compilation, and the
emitted WOFF2 count. The current Next/Turbopack build preserves Carbon's valid
`@position-try` rules but emits four parser warnings. Do not strip upstream CSS;
reassess the warnings when upgrading Next or Carbon.

The pinned source mapping covers 147 React story files, 547 AST-derived named
stories, 198 React-package MDX files, and 317 Carbon website MDX files. Review
the [closed-world coverage](knowledge-base/source-coverage.md) during every
Carbon upgrade.

## Official sources

- [Carbon React framework guide](https://carbondesignsystem.com/developing/frameworks/react/)
- [Carbon themes](https://carbondesignsystem.com/elements/themes/overview/)
- [Carbon typography](https://carbondesignsystem.com/elements/typography/overview/)
- [Carbon 2x Grid](https://carbondesignsystem.com/elements/2x-grid/overview/)
- [Carbon spacing](https://carbondesignsystem.com/elements/spacing/overview/)
- [Carbon motion](https://carbondesignsystem.com/elements/motion/overview/)
- [Carbon icons](https://carbondesignsystem.com/elements/icons/code/)
- [Carbon Charts](https://carbondesignsystem.com/data-visualization/simple-charts/)
- [Carbon source](https://github.com/carbon-design-system/carbon)
- [Carbon Charts source](https://github.com/carbon-design-system/carbon-charts)
- [IBM Plex source](https://github.com/IBM/plex)
