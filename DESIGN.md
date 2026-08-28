# BAP Design

Phase 1 makes no visual-design decisions and installs no design dependencies.
Its web page exists only as a semantic runtime and test surface.

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
