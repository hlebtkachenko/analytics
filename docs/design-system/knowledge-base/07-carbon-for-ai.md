# Carbon for AI

> Modified BAP guidance. Source:
> [Carbon for AI](https://carbondesignsystem.com/guidelines/carbon-for-ai/) at
> website commit `df723531e56036f90bac8b1bbec7a0414a285063`, plus Carbon React
> tag `v11.115.0`. This chapter is original BAP prose.

## Purpose

Carbon for AI makes AI-generated or AI-influenced content identifiable and
provides a path to an explanation. The visual treatment is a disclosure
mechanism, not decoration or branding.

Use it only when AI materially generated, transformed, ranked, recommended, or
decided content shown to the user.

## Required disclosure model

An AI experience must answer:

1. Where is AI present?
2. What did it do to this content or decision?
3. How can the user inspect an explanation?
4. What can the user change, reject, or override?
5. What state remains after a user override?

Place the AI label at the smallest level that truthfully describes AI scope. A
page-level label must not imply that every value is AI-generated when only one
field is.

## AI label and explainability

`AILabel` identifies AI presence. `AILabelContent` holds concise explanation
content and `AILabelActions` holds relevant next actions. The label must have an
accessible name and the disclosure must operate by keyboard and touch.

Start with a short in-context explanation. Link to deeper model, data,
confidence, limitations, or governance information only when it exists and is
useful to the task.

Older Slug aliases remain available for compatibility. New code and
documentation use AI label terminology.

## AI presence variants

Carbon defines AI presence treatment for these core families:

- Checkbox
- Form
- Select
- DataTable
- Modal
- Tag
- DatePicker
- NumberInput
- TextInput
- Dropdown
- RadioButton
- Tile

The workbench compares neutral standard and supported AI-presence composition
for every family across the white, g10, g90, and g100 themes. Modal is a single
AI-presence dialog so the workbench never opens two dialogs. It does not claim a
universal focus, error, warning, read-only, disabled, or override state: those
are shown only where the pinned component exposes that documented state. Form is
a composition boundary, DataTable uses its AI table APIs, and Tile uses its
AI-label-only rounded-corner option.

## Revert behavior

When a user manually replaces AI-generated content, the component should return
to its normal visual treatment. If reverting to the AI proposal is supported,
provide an explicit Revert to AI action and preserve the distinction between the
user's current value and the prior suggestion.

Do not silently overwrite user edits after a model response arrives.

## AI skeletons

`AISkeletonText`, `AISkeletonIcon`, and `AISkeletonPlaceholder` communicate that
AI content is being prepared. They do not replace a textual loading state or
justify indefinite waiting. Respect reduced motion and stop announcing repeated
updates.

## Chat boundaries

`ChatButton` is preview/unstable in the pinned React package. Carbon AI Chat is
a separate extension and is not installed as Carbon Core. The workbench may show
the exact exported ChatButton state with a warning; it must not fabricate a chat
application or claim that Carbon AI Chat is locally available.

## Accessibility

AI presence must remain perceivable without relying on glow, gradient, or color.
Use the provided AI label, maintain contrast, limit light spread around content,
and preserve focus visibility. Explanation content must be reachable,
dismissible, and readable in the current theme and zoom level.

## Content rules

Use direct wording. State what AI did, not a vague claim that an experience is
"powered by AI." Describe limitations that affect the task. Never imply
certainty, authority, or human review that the system does not provide.

## Neutral implementation

```tsx
'use client';

import {
  AILabel,
  AILabelActions,
  AILabelContent,
  Button,
} from '@bap/design-system/react';

export function NeutralAiDisclosure() {
  return (
    <AILabel>
      <AILabelContent>
        <p>This example marks content produced by an automated system.</p>
        <AILabelActions>
          <Button kind="ghost" size="sm">
            View explanation
          </Button>
        </AILabelActions>
      </AILabelContent>
    </AILabel>
  );
}
```

Consult the generated workbench for the exact pinned component composition and
props before adopting this illustrative structure.

## Review checklist

- AI presence is disclosed at the correct scope.
- The label opens a useful explanation.
- User control and override behavior are explicit.
- Revert behavior does not destroy user work.
- Styling is not used on non-AI content.
- Disclosure works without color or motion.
- Any preview API has a migration boundary.
- No model, data source, or confidence claim is invented.
