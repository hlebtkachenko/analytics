# Orientation and Adoption Boundary

> Modified BAP guidance. Sources:
> [What is Carbon](https://carbondesignsystem.com/all-about-carbon/what-is-carbon/),
> [Carbon ecosystem](https://carbondesignsystem.com/all-about-carbon/the-carbon-ecosystem/),
> and
> [React framework](https://carbondesignsystem.com/developing/frameworks/react/),
> frozen through Carbon website commit
> `df723531e56036f90bac8b1bbec7a0414a285063` and Carbon tag `v11.115.0`. This
> chapter is rewritten for BAP and does not reproduce upstream prose.

## What Carbon means in BAP

Carbon is the sole visual foundation for BAP. Carbon Core supplies reusable UI
components, semantic tokens, layout rules, icons, pictograms, motion, and
accessibility behavior. Carbon Charts supplies data-visualization components.
BAP integrates those assets through one workspace package:

```text
Carbon packages -> @bap/design-system -> BAP applications
```

Application code does not import `@carbon/*` directly. This boundary keeps theme
setup, global styles, upgrade checks, and release classification in one place.
It also lets a fresh agent search one workbench instead of several upstream
websites.

## Core, extensions, and product code

Treat these as different layers:

| Layer             | Included here                                                          | Rule                                                  |
| ----------------- | ---------------------------------------------------------------------- | ----------------------------------------------------- |
| Carbon Core       | React, styles, themes, icons, pictograms, Plex, foundational packages  | Preferred source for universal UI                     |
| Carbon Charts     | React charts and network-diagram primitives                            | Use for supported visualizations                      |
| Carbon extensions | Carbon for IBM Products, Carbon Labs, Carbon AI Chat, domain libraries | Out of scope unless separately approved and installed |
| BAP product UI    | Screens and compositions tied to actual requirements                   | Build only when product behavior is defined           |

An item shown in an upstream repository is not automatically a supported BAP
API. The generated catalog must confirm that it is exported by an installed
package. Preview and unstable APIs remain discoverable but carry an explicit
stability warning.

## What completeness means

Completeness is closed-world and versioned. For the pinned release it means:

- every public export is classified;
- every renderable export has an individual Default and Playground entry;
- compound children are shown inside a valid parent;
- every supported discriminant, state, controlled mode, composition, feature
  flag, and responsive behavior has a named specimen or a documented exclusion;
- all visual assets are searchable without rendering thousands at once;
- all source evidence is mapped locally;
- the static workbench runs without network access.

Completeness does not mean rendering every cartesian prop combination. Many
combinations are invalid, redundant, or dependent on application state. The
typed coverage registry states which combinations are supported and why.

## Decision order

When implementing UI, decide in this order:

1. Define the user's task, content, permissions, and state transitions.
2. Choose the Carbon pattern that governs the flow.
3. Select the smallest stable Carbon component or composition that satisfies it.
4. Choose semantic tokens, grid placement, and density.
5. Add localization, keyboard, screen-reader, loading, empty, error, and
   responsive behavior.
6. Use a preview or unstable API only after recording the migration risk.
7. Add a BAP-owned wrapper only when at least two real consumers need the same
   non-product-specific behavior.

## Where truth lives

Use the following precedence when information differs:

1. Installed package declarations and runtime exports.
2. Generated BAP catalog and coverage registry.
3. Executable local Storybook examples.
4. This handbook.
5. Online documentation for historical or explanatory context.

The handbook explains intent. It does not override TypeScript or claim that a
non-exported upstream experiment is supported.

## Safe neutral fixtures

Workbench examples use short labels such as `Item one`, `Option A`, and
`Value 24`. They do not model customers, employees, companies, transactions, or
analytics. A fixture demonstrates component behavior only.

## Quick start

```tsx
'use client';

import { Button, Stack } from '@bap/design-system/react';

export function NeutralActions() {
  return (
    <Stack orientation="horizontal" gap={5}>
      <Button kind="primary">Continue</Button>
      <Button kind="secondary">Cancel</Button>
    </Stack>
  );
}
```

The import boundary is the important part. The exact available props and states
are discoverable in the local workbench.
