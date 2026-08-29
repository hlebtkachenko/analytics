# Carbon Workbench Delivery Plan

## Objective

Build a complete, locally runnable reference for the Carbon Core release pinned
by BAP. A fresh checkout must let an agent discover every installed public API,
inspect supported states, read the governing guidance, and build or test the
workbench without fetching documentation from the internet.

The BAP package remains a facade over official Carbon packages. It does not fork
Carbon source, copy the Carbon website, or add speculative product UI.

## Pinned evidence

| Source          | Pin                                                                | Closed-world input                                                                   |
| --------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Carbon monorepo | tag `v11.115.0`, commit `7518c84ffd00f22434fe19d83119692c12fccb2f` | React exports, 147 story files, 547 AST-derived named stories, 198 package MDX files |
| Carbon website  | commit `df723531e56036f90bac8b1bbec7a0414a285063`                  | 317 website MDX pages                                                                |
| Carbon Charts   | tag `v1.27.18`, commit `abd30134f12462c9215a823543fdda56779719e6`  | installed package source/version, declarations, chart fixtures, and diagram fixtures |

Package manifests and generated inventories, rather than a remembered list,
define the release boundary. Module-mode checks remain separate because the
React ESM namespace has 367 keys and the CommonJS namespace has 365 keys in the
pinned release.

## Included scope

- Every installed public React, icon, pictogram, and chart export.
- Recursive namespace members, compound children, hooks, contexts, constants,
  preview APIs, unstable APIs, aliases, and deprecated names.
- Default and Playground workbench entries for every renderable export.
- Supported variants expressed through props, state, composition, feature flags,
  context, and responsive behavior.
- Four themes, semantic tokens, IBM Plex, grid, layout, layers, type, spacing,
  motion, icons, pictograms, Charts, and diagrams.
- Original offline guidance for designing, developing, patterns, Carbon for AI,
  accessibility, internationalization, contribution, and upgrades.
- Deterministic provenance for every pinned source, plus closed-world story/MDX
  mappings for the Carbon monorepo and website inputs listed above.

## Explicit exclusions

- Carbon for IBM Products, Carbon Labs, Carbon AI Chat, and other separately
  distributed extensions.
- IBM-only design assets that cannot be redistributed.
- Arbitrary prop combinations that Carbon does not support.
- Fabricated BAP screens, business logic, or realistic business data.
- Upstream prose, images, implementation source, and Cube UI Kit code.

## Architecture

### Design-system facade

`@bap/design-system` is the single consumption boundary. Generated manifests
classify the exact upstream API and expose server-safe metadata. Client
entrypoints re-export React components, icons, pictograms, and charts. Sass
entrypoints forward Carbon modules without copying token values.

The catalog generator uses the TypeScript compiler and installed package files
to record:

- package versions and source pins;
- CommonJS, ESM, type-only, default, alias, and namespace exports;
- component status and renderability;
- props, required parents, discriminants, booleans, controlled states, and
  feature flags;
- themes and public color, type, spacing, layout, grid, layer, and motion
  values;
- public Sass variables, maps, functions, mixins, aliases, and breakpoints;
- chart option types, diagrams, icons, and pictograms.

Committed generated output is refreshed intentionally. Check mode regenerates to
temporary storage and fails on any difference, unclassified export, missing
target, or unknown status.

### Workbench

The `apps/design-system-workbench` Storybook application consumes only BAP
facades. It provides four theme modes, left-to-right and right-to-left
directions, Carbon viewports down to 320px, pinned feature flags, reduced-motion
coverage, searchable virtualized visual-asset explorers, generated component
entries, charts, diagrams, pattern specimens, local knowledge pages, and
provenance search.

Default and Playground entries are individual and searchable. Compound children
use valid parent fixtures. Preview, unstable, deprecated, and feature-flagged
surfaces appear in warned sections and are never presented as stable defaults.

### Offline knowledge base

The handbook starts at
[`docs/design-system/knowledge-base/README.md`](../design-system/knowledge-base/README.md).
It contains 11 implementation chapters plus closed-world source mappings. Every
chapter is original BAP prose with source and modified-work attribution.

## Verification contract

- Frozen install under Node 24.20 and pnpm 11.
- Exact mode-specific facade parity.
- Zero unclassified public exports and zero unmapped pinned sources.
- Default and Playground coverage for each renderable item.
- Valid chart, diagram, icon, and pictogram fixtures.
- Static workbench build with no remote asset or documentation request.
- Unit, interaction, keyboard, axe, and representative visual checks.
- Playwright smoke across every default entry and representative variants.
- Repository gate, leak scan, license audit, and focused review.

The ordinary pull-request matrix should remain below four minutes per job by
sharding browser checks and testing representative risk states instead of every
cartesian prop combination.

## Local commands

```bash
pnpm design-system:dev
pnpm design-system:build
pnpm design-system:catalog
pnpm design-system:catalog:check
pnpm design-system:test
pnpm design-system:test:browser
pnpm design-system:offline:check
```

## Progress ledger

| Workstream                 | Completion evidence                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------- |
| Research and source freeze | Three source pins and closed-world counts recorded above                                    |
| Offline handbook           | Eleven chapters plus source-coverage documents exist and relative links validate            |
| Package catalog            | Generated manifests classify all installed exports and token surfaces                       |
| Storybook workbench        | Static build exposes all generated entries, explorers, patterns, and handbook pages         |
| Contract tests             | Catalog check, facade parity, story coverage, offline test, and accessibility checks pass   |
| Delivery                   | Pending final review, branch push, and green remote checks; the pull request stays unmerged |

## Acceptance

The work is complete when a fresh agent can use only repository files to find
every installed Carbon Core API, understand its status and valid usage, switch
themes and viewports, inspect interaction examples, use charts and visual
assets, and build a BAP page through `@bap/design-system`.
