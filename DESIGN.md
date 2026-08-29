# BAP Design

Carbon Design System is the sole BAP design system. The repository integrates
the official Carbon React library, its Sass foundation, IBM Plex font families,
Carbon icons and pictograms, Carbon Charts, and Carbon accessibility guidance
without creating product layouts, workflows, or business visualizations.

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

Foundation identity and access surfaces use official Carbon form, feedback,
layout, and content primitives through `@bap/design-system`. They establish no
dashboard or analytics visual design. Do not add another component system,
utility CSS framework, raw palette values, or copied Carbon source.
