# Foundations and Tokens

> Modified BAP guidance. Sources: Carbon color, theme, typography, spacing, 2x
> Grid, motion, icon, and pictogram pages at website commit
> `df723531e56036f90bac8b1bbec7a0414a285063`; package values come from Carbon
> tag `v11.115.0`. This chapter is original BAP prose and package names remain
> IBM terminology.

## Foundations are an API

Foundations are not decoration. Theme roles, typography, spacing, grid,
containers, layers, motion, icons, pictograms, and font faces form a versioned
contract. Use the generated token explorer for the exhaustive pinned symbol
list. This chapter explains how to choose those symbols.

## Themes

Carbon provides four default themes:

| Theme   | Mode  | Base background |
| ------- | ----- | --------------- |
| `white` | Light | White           |
| `g10`   | Light | Gray 10         |
| `g90`   | Dark  | Gray 90         |
| `g100`  | Dark  | Gray 100        |

Light themes alternate white and Gray 10 layers. Dark themes become lighter as
layers rise. Use `Theme` for a deliberate inline theme region and `Layer` for
nested component surfaces. Do not simulate depth with raw background values.

## Semantic color

A token names a role and a theme supplies its value. Choose by role:

- background and layer tokens establish surfaces;
- field tokens establish input surfaces;
- border tokens separate and emphasize;
- text, link, and icon tokens express content hierarchy;
- button tokens belong to button treatments;
- support tokens communicate error, warning, success, and information;
- focus tokens preserve keyboard visibility;
- skeleton and highlight tokens support transient emphasis;
- AI tokens identify AI presence only.

Never bind application meaning to a palette step such as Blue 60. Bind it to a
semantic role. Never use color as the only status cue.

The pinned `@carbon/themes` package exposes hundreds of values, including each
theme and Carbon for AI roles. The catalog generates the complete table. A short
prose list is not an exhaustive token manifest.

## Typography and IBM Plex

IBM Plex is Carbon's typeface. BAP self-hosts Sans, Mono, and Serif with the
selected light, regular, and semibold faces and language subsets. Sans is the
default UI family; Mono is for code or fixed-width technical content; Serif is
available when a documented editorial treatment needs it.

Productive type uses a 14px base and supports task-focused interfaces.
Expressive type uses a 16px base and supports editorial or high-emphasis
moments. Use Carbon type tokens for captions, labels, helper text, body, code,
headings, quotations, legal text, and fluid display styles. Do not build a new
type scale in application CSS.

Preserve semantic heading order even when the visual token differs from the HTML
level.

## Spacing

Carbon's spacing scale is:

| Token range                       | Values                                             |
| --------------------------------- | -------------------------------------------------- |
| `spacing-01` through `spacing-13` | 2, 4, 8, 12, 16, 24, 32, 40, 48, 64, 80, 96, 160px |

Use smaller tokens inside a component relationship and larger tokens between
sections. Proximity communicates grouping. Do not insert arbitrary margins to
compensate for a wrong grid span or wrong component size.

## 2x Grid and responsive layout

The mini unit is 8px. Carbon's breakpoints are:

| Name  | Minimum width |
| ----- | ------------- |
| `sm`  | 320px         |
| `md`  | 672px         |
| `lg`  | 1056px        |
| `xlg` | 1312px        |
| `max` | 1584px        |

Use `Grid`, `Column`, and responsive spans. A fluid column scales content within
a stable column count; fixed boxes retain selected dimensions and wrap; hybrid
regions combine a fluid axis with a fixed axis. Headers and toolbars commonly
use a fluid width and fixed height. Data tables usually need fluid width and
content-driven height.

Valid aspect ratios include 1:1, 2:1, 2:3, 3:2, 4:3, and 16:9. `AspectRatio`
should express a genuine media or layout relationship, not force arbitrary
content into a box.

```tsx
'use client';

import { Column, Grid, Stack } from '@bap/design-system/react';

export function NeutralGrid() {
  return (
    <Grid>
      <Column sm={4} md={4} lg={8}>
        <Stack gap={5}>Primary region</Stack>
      </Column>
      <Column sm={4} md={4} lg={4}>
        Secondary region
      </Column>
    </Grid>
  );
}
```

## Containers and layout utilities

Container tokens constrain readable or functional regions. Stack, HStack, and
VStack arrange related items while retaining Carbon spacing. Prefer logical
properties such as `inline-size`, `margin-inline`, and `padding-block` so RTL
does not need mirrored CSS overrides.

## Layers

Layer level is contextual. Place a component inside `Layer` when it sits on a
nested surface and needs the next semantic field, border, and background roles.
Do not hard-code `layer-02` because the component happens to look correct in one
theme.

```tsx
'use client';

import { Layer, TextInput } from '@bap/design-system/react';

export function LayeredField() {
  return (
    <Layer>
      <TextInput id="neutral-field" labelText="Label" />
    </Layer>
  );
}
```

## Motion

Productive motion is quick and task-focused. Expressive motion is reserved for
important, occasional transitions. Carbon supplies standard, entrance, and exit
curves for both styles, plus six duration tokens:

| Token                  | Duration |
| ---------------------- | -------- |
| `duration-fast-01`     | 70ms     |
| `duration-fast-02`     | 110ms    |
| `duration-moderate-01` | 150ms    |
| `duration-moderate-02` | 240ms    |
| `duration-slow-01`     | 400ms    |
| `duration-slow-02`     | 700ms    |

Standard easing applies when an element remains visible. Entrance easing slows
an arriving element. Exit easing accelerates a departing element. Always provide
an equivalent state change under reduced motion.

## Icons

Use an icon to reinforce an action or concept, not as ornament. Carbon icons are
optimized at 16, 20, 24, and 32px. Match icon and adjacent text color and center
their alignment. Interactive icon targets must be at least 44px even when the
glyph is smaller. Prefer the Carbon component's `renderIcon` or icon prop and
keep a useful visible label. A glyph that repeats the label is decorative,
`aria-hidden`, and never a separate focus stop.

```tsx
'use client';

import { Download } from '@bap/design-system/icons';
import { Button } from '@bap/design-system/react';

export function DownloadAction() {
  return (
    <Button renderIcon={Download} size="lg">
      Download CSV
    </Button>
  );
}
```

Use named imports from the exact 18-export curated BAP facade. Add an export
only with a real application call site and never import the upstream package
directly. The virtualized workbench explorer shows those 18 executable glyphs;
the generated catalog remains the exhaustive installed upstream icon inventory.

## Pictograms

Pictograms communicate a broader concept and occupy more space than UI icons.
All 1,575 installed exports come from the separate
`@bap/design-system/pictograms` facade and appear in its complete workbench
explorer. Do not use a pictogram as a compact control glyph. Give informative
pictograms an accessible text alternative in surrounding content and hide
decorative repetitions from assistive technology.

## Fonts

Import the BAP font stylesheet once. Do not fetch IBM Plex from a CDN. Keep
fallbacks available while local WOFF2 assets load and test glyph coverage for
the supported locale. Bold is not a substitute for semantic emphasis, and
semibold should not be used for long text.

## Sass access

Forwarded entrypoints preserve upstream names:

```scss
@use '@bap/design-system/tokens/colors' as colors;
@use '@bap/design-system/tokens/grid' as grid;
@use '@bap/design-system/tokens/layout' as layout;
@use '@bap/design-system/tokens/motion' as motion;
@use '@bap/design-system/tokens/spacing' as spacing;
@use '@bap/design-system/tokens/theme' as theme;
@use '@bap/design-system/tokens/themes' as themes;
@use '@bap/design-system/tokens/type' as type;
```

The catalog and Sass compile checks define the exhaustive symbol list. Use a
category entrypoint when possible so similarly named upstream symbols remain
unambiguous.
