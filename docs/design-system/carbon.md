# Carbon Integration

## Scope

`@bap/design-system` is the only BAP design-system package. It adapts the
official Carbon packages rather than copying their source or creating product
components. It contains no business concepts, layouts, synthetic analytics, or
brand overrides.

Current exact versions are maintained in the workspace catalog:

- `@carbon/react` `1.115.0`
- `@carbon/icons-react` `11.87.0`
- `@carbon/charts-react` `1.27.18`
- `@ibm/plex-sans` `1.1.0`
- `@ibm/plex-mono` `1.1.0`
- `@ibm/plex-serif` `2.0.0`
- `sass` `1.103.1`

Carbon supports React 19. The package declares React, React DOM, and React-is as
peers so an application provides one compatible React runtime.

## Public entrypoints

| Entrypoint                       | Boundary    | Purpose                                                    |
| -------------------------------- | ----------- | ---------------------------------------------------------- |
| `@bap/design-system`             | Server-safe | Semantic metadata and type exports only                    |
| `@bap/design-system/react`       | Client      | Full official `@carbon/react` public API                   |
| `@bap/design-system/icons`       | Client      | Full official `@carbon/icons-react` public API             |
| `@bap/design-system/charts`      | Client      | Full official `@carbon/charts-react` API plus `ChartFrame` |
| `@bap/design-system/theme`       | Client      | `DesignSystemProvider`                                     |
| `@bap/design-system/tokens`      | Server-safe | Semantic inventory and theme types                         |
| `@bap/design-system/styles.scss` | Global      | Carbon CSS plus BAP root theme selectors                   |
| `@bap/design-system/fonts.scss`  | Global      | Selected self-hosted IBM Plex faces                        |
| `@bap/design-system/charts.css`  | Global      | Official Carbon Charts styles                              |

The React, icon, and chart facades use `export *`, so their installed public
APIs are complete without maintaining a hand-written component barrel. The
pinned React package currently exposes 367 public keys and the package test
asserts that count and representative primitives. The source-family inventory in
`tokens.ts` is documentation metadata, not a claim that every family name is a
direct React export.

Use the client facades from a Client Component. Server Components may import
metadata from the root or `tokens` entrypoints, then pass serializable props to
client leaf components. The web app opts into workspace transpilation through
`transpilePackages`.

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

The React facade supplies all installed Carbon components. The package tracks
the current Carbon source component families in `carbonComponentFamilies`,
including forms, UI Shell, tables, menus, modals, tiles, skeletons, loading,
notifications, pagination, date/time controls, tree views, AI labels, and layout
primitives. Feature-flagged, experimental, or deprecated upstream exports remain
upstream API and must be assessed before product use.

The icon facade exports every official Carbon React icon. Use named imports and
the approved 16, 20, 24, or 32px sizes. Use an accessible text label or an
appropriate `aria-label` when an icon conveys an action.

The charts facade exports the 25 standard React chart components: area, stacked
area, grouped/simple/stacked bar, boxplot, bubble, bullet, choropleth, donut,
gauge, histogram, line, lollipop, pie, scatter, meter, radar, combo, tree,
treemap, circle pack, word cloud, alluvial, and heatmap. It also exports
`ExperimentalChoroplethChart` and all diagram primitives, including CardNode
parts, Edge, ShapeNode, and marker exports. The metadata and tests distinguish
these categories and assert every chart-related name against the pinned package.

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
`NEXT_TELEMETRY_DISABLED=1`.

Carbon React, Carbon Charts, and Carbon Icons are Apache-2.0. IBM Plex is
OFL-1.1. See `THIRD_PARTY_NOTICES.md`. When upgrading, update the exact catalog
versions and lockfile together, run the complete gate, review Carbon release
notes, verify facade inventory tests, Sass compilation, and the emitted WOFF2
count. The current Next/Turbopack build preserves Carbon's valid `@position-try`
rules but emits four parser warnings. Do not strip upstream CSS; reassess the
warnings when upgrading Next or Carbon.

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
