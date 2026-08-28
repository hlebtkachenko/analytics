# BAP Design

Carbon Design System is the sole BAP design system. Phase 2 integrates the
official Carbon React library, its Sass foundation, IBM Plex font families,
Carbon icons, Carbon Charts, and Carbon accessibility guidance without creating
product layouts, workflows, or business visualizations.

The implementation lives in `@bap/design-system`. Product code must consume its
public entrypoints and semantic Carbon tokens instead of copying Carbon source,
hard-coding palette values, or introducing another component library. See
[the Carbon integration guide](docs/design-system/carbon.md) for the contract
and [the pattern guide](docs/design-system/patterns.md) before adding user
interfaces.

Foundation identity and access surfaces use official Carbon form, feedback,
layout, and content primitives through `@bap/design-system`. They establish no
dashboard or analytics visual design. Do not add another component system,
utility CSS framework, raw palette values, or copied Carbon source.
