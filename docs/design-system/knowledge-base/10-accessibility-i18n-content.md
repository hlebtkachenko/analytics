# Accessibility, Internationalization, and Content

> Modified BAP guidance. Sources: Carbon accessibility and content pages at
> website commit `df723531e56036f90bac8b1bbec7a0414a285063`, plus component
> accessibility contracts at Carbon tag `v11.115.0`. This chapter is original
> BAP prose.

## Shared responsibility

Carbon provides accessible component foundations. BAP remains responsible for
semantic composition, names, descriptions, content order, focus, application
state, localization, and equivalent information.

## Semantic structure

- Use one meaningful page heading and a logical heading hierarchy.
- Use landmarks for header, navigation, main, complementary, and footer regions.
- Use buttons for actions and links for navigation.
- Use lists, tables, forms, and field groups according to their meaning.
- Preserve Carbon's roles and relationships when composing compound components.

Visual size does not determine HTML level. A styled heading can remain the
correct semantic level through Carbon's Heading and Section model.

## Names and descriptions

Every interactive control needs a concise accessible name. Visible text should
usually provide it. Icon-only actions need `label` or `aria-label` through the
component API. Helper text, constraints, and error messages must be associated
with the field they explain.

Do not duplicate visible and hidden labels in a way that causes repeated speech.

```tsx
'use client';

import { Download } from '@bap/design-system/icons';
import { IconButton } from '@bap/design-system/react';

export function NeutralDownload() {
  return (
    <IconButton label="Download example">
      <Download />
    </IconButton>
  );
}
```

## Keyboard and focus

- DOM order must match reading and focus order.
- Keep Carbon's visible focus indicator.
- Support documented arrow-key models for menus, tabs, radio groups, trees, and
  listboxes.
- Escape closes transient layers when documented.
- Modal focus stays inside while open and returns to a logical trigger.
- Dynamic content does not move focus unless the user needs it to continue.
- SkipToContent targets the main region in a UI Shell.

Do not add positive `tabIndex` values to repair a visual ordering problem.

## Color, contrast, and state

Normal text needs 4.5:1 contrast in typical sizes. Interactive boundaries,
icons, and focus indicators need 3:1 against adjacent colors. Test all four
themes and nested layers. Disabled controls still need enough context for users
to understand the interface even when the disabled element is exempt from a
normal contrast rule.

Pair color with text, icon, shape, pattern, or position. This is mandatory for
notifications, tags, indicators, form states, and chart series.

## Zoom, reflow, and text spacing

Test browser zoom to 200% and reflow or narrow layout behavior through the 320px
viewport. Test 400% where content or interaction risk is high. Content must not
be lost behind fixed regions. User-adjusted text spacing must not clip labels,
values, errors, or actions.

## Motion

Custom motion must respect `prefers-reduced-motion`. A state transition must
remain understandable when animation is removed. Avoid auto-playing, flashing,
bouncing, or decorative movement. Loading and AI skeletons need textual state
that does not depend on animation.

## Forms and errors

Use persistent labels. Mark required or optional fields consistently. Explain a
constraint before it causes an error when possible. Error text states what is
wrong and how to fix it. Preserve valid input when submission fails.

For multiple errors, provide a reviewable summary when useful and focus the
first actionable location deliberately. Do not announce the same message from
several live regions.

## Dynamic status and notifications

Choose live-region urgency from the impact. Use polite announcements for most
updates and assertive behavior only for urgent interruptions. A toast that
disappears is not suitable for information the user must revisit.

Loading, success, failure, and result-count messages should be concise and
should not repeat on every small state change.

## Charts and diagrams

Every chart has a visible title, SVG label, units, localized formatting, and a
complete table equivalent. Every diagram has an ordered textual description of
nodes and edges. Tooltips are supplemental. Color, area, or spatial position
cannot be the only route to meaning.

## Internationalization

All application strings, including Carbon translation props, come from the
application locale. Avoid concatenating translated fragments. Support plural
forms and sentence-level translation. Use `Intl`-compatible formatting for
dates, times, time zones, numbers, currencies, percentages, lists, and relative
time.

Keep internal identifiers separate from localized labels. A translated label is
not a stable DataTable key, form value, or chart group identifier.

## Component translation hooks

Many Carbon components expose `translateWithId` or named label props. Supply a
total mapping for the identifiers used by the pinned component and allow a safe
fallback during development.

```tsx
'use client';

import { Pagination } from '@bap/design-system/react';

const messages: Record<string, string> = {
  itemsPerPage: 'Items per page:',
  itemRange: 'Item range',
  itemText: 'item',
  itemsText: 'items',
  nextPage: 'Next page',
  pageNumber: 'Page number',
  pageRange: 'Page range',
  pageText: 'page',
  pagesText: 'pages',
  previousPage: 'Previous page',
};

export function NeutralPagination() {
  return (
    <Pagination
      backwardText={messages.previousPage}
      forwardText={messages.nextPage}
      itemsPerPageText={messages.itemsPerPage}
      page={1}
      pageSize={10}
      pageSizes={[10, 20]}
      totalItems={40}
    />
  );
}
```

Use the generated story for the exact pinned translation identifiers. The
example demonstrates externalized strings without selecting a product locale.

## RTL and logical layout

Set document direction through the application locale and use logical CSS
properties. Verify icon direction, menu placement, date input behavior, chart
axes, breadcrumb order, pagination controls, and keyboard expectations. Do not
mirror universally recognizable or data-directional icons without checking their
meaning.

## Content style

- Use direct, concise, task-focused language.
- Start action labels with a specific verb.
- Use sentence case unless a proper name requires otherwise.
- Avoid jargon, idioms, unexplained abbreviations, and directional instructions.
- State errors and next steps without blame.
- Keep terminology stable across components, help, and announcements.
- Do not put essential instructions only in placeholder or tooltip text.

## Test matrix

For a changed interaction, test:

- keyboard-only operation;
- VoiceOver on macOS for representative complex behavior;
- automated accessibility for default and complex states;
- all four themes and nested layers;
- 320px, zoom, text expansion, and long translations;
- RTL where direction can affect behavior;
- reduced motion;
- pointer and touch target size;
- table or textual alternatives for visualizations.

Record known upstream limitations openly. Do not disable an accessibility rule
without a narrowly scoped, reviewed reason.
