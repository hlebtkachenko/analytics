# Designing Workflow

> Modified BAP guidance. Sources:
> [Designing get started](https://carbondesignsystem.com/designing/get-started/),
> [2x Grid](https://carbondesignsystem.com/elements/2x-grid/overview/), and
> Carbon component and pattern guidance at website commit
> `df723531e56036f90bac8b1bbec7a0414a285063`. This chapter is original BAP
> prose.

## Start with the task

Do not begin by selecting a visual treatment. Write the user goal, available
information, decisions, permissions, and completion condition first. Then map
that task to a Carbon pattern and component composition.

A design handoff must identify:

- the primary task and supporting tasks;
- entry, success, empty, loading, partial, error, and permission-denied states;
- information hierarchy and reading order;
- responsive behavior from 320px upward;
- keyboard order, focus destination, names, descriptions, and announcements;
- strings that can expand or change direction;
- data units, formats, missing values, and table equivalents for charts;
- any preview or feature-flag dependency.

## Use foundations before custom styling

Create the page skeleton on the Carbon grid. Use semantic theme tokens for
color, type tokens for hierarchy, spacing tokens for rhythm, and Layer for
nested surfaces. Avoid arbitrary offsets that hide a structural problem.

The 2x Grid is based on an 8px mini unit. Carbon's responsive breakpoints are
320, 672, 1056, 1312, and 1584px. Components may have fixed-height behavior
inside fluid columns. Test content wrapping at each breakpoint and between
breakpoints.

## Select a pattern, then components

Patterns describe how a goal is achieved. Components are the implementation
parts. For example, filtering is a pattern; Dropdown, Tag, Button, and DataTable
may participate in it. Do not call a row of controls a pattern unless it has
defined application behavior.

Use the [pattern catalog](06-patterns.md) to establish expected behavior. Use
the [component guide](05-components.md) for the actual composition.

## Define variants deliberately

Record only variants that communicate a meaningful difference:

- size or density;
- kind or emphasis;
- enabled, hover, active, focus, selected, expanded, invalid, warning,
  read-only, disabled, and loading states;
- controlled and uncontrolled modes;
- with and without optional supporting content;
- responsive reflow and overflow;
- theme, layer, direction, and reduced-motion behavior.

Do not treat every boolean permutation as a design variant. A combination that
cannot occur in the product should not appear in a product specification.

## Theme and layer review

Review all four themes: `white`, `g10`, `g90`, and `g100`. Check nested layers,
focus, disabled content, support states, and any chart palette. Theme review is
not complete if only a page background changes.

Use inverse tokens only for intended high-contrast moments. Do not select raw
palette values to imitate a theme token.

## Content and localization review

Use action-first button labels, descriptive headings, explicit errors, and
concise helper text. Avoid directional wording when the interface can run RTL.
Test a long translation, a short translation, mixed numerals, and a locale with
different date and number formats.

Carbon strings exposed through component translation props must be supplied by
the application's localization layer. Never edit text inside a vendored
component.

## Accessibility review

The visual specification must include focus order and focus return, not only
mouse states. Specify accessible names for icon-only actions and an announced
relationship for helper and error text. Use color plus another cue for status.

For charts, include the exact equivalent table, units, title, and SVG label. For
diagrams, provide an ordered textual description of nodes and edges.

## Handoff checklist

Before implementation, confirm:

- a stable Carbon asset was considered first;
- the grid, token, and component names are explicit;
- all meaningful states are shown;
- overflow, zoom, and 320px behavior are specified;
- strings and formats are localizable;
- keyboard and screen-reader behavior is specified;
- preview, unstable, or extension use is called out;
- no realistic or sensitive data appears in the design fixture.

## Design tools and offline limitation

Carbon's Figma libraries remain the visual source for designers, but some are
IBM-only and cannot be embedded in this public repository. The local workbench
is the code source for the pinned release. A fresh agent can implement from the
workbench and handbook, but cannot recreate restricted Figma library metadata
from this repository.
