# Developing with Next App Router

> Modified BAP guidance. Sources:
> [Developing get started](https://carbondesignsystem.com/developing/get-started/),
> [React framework](https://carbondesignsystem.com/developing/frameworks/react/),
> and Carbon React source at tag `v11.115.0`. This chapter is rewritten for BAP.

## Import boundary

Use only the BAP facade:

| Need                     | Import                                              |
| ------------------------ | --------------------------------------------------- |
| Components and providers | `@bap/design-system/react`                          |
| Icons                    | `@bap/design-system/icons`                          |
| Pictograms               | `@bap/design-system/pictograms`                     |
| Charts and `ChartFrame`  | `@bap/design-system/charts`                         |
| Root theme provider      | `@bap/design-system/theme`                          |
| Server-safe metadata     | `@bap/design-system` or `@bap/design-system/tokens` |
| Sass and global CSS      | exported style entrypoints                          |

Do not deep-import Carbon implementation files. Only public BAP entrypoints are
covered by upgrade tests.

## Server and Client Components

Carbon React components use browser behavior and belong in Client Components.
Keep data loading and serializable view preparation in Server Components, then
pass plain props to small client leaves.

```tsx
// status-action.tsx
'use client';

import { Button } from '@bap/design-system/react';

type StatusActionProps = Readonly<{
  disabled: boolean;
  label: string;
  onActivate: () => void;
}>;

export function StatusAction({
  disabled,
  label,
  onActivate,
}: StatusActionProps) {
  return (
    <Button disabled={disabled} onClick={onActivate}>
      {label}
    </Button>
  );
}
```

Do not pass functions, Carbon component constructors, or other non-serializable
values through a Server Component boundary.

## Root layout setup

Import global assets once, in this order:

```tsx
import '@bap/design-system/styles.scss';
import '@bap/design-system/fonts.scss';
import '@bap/design-system/charts.css';
```

Render the initial `data-carbon-theme` value on `<html>` so the first paint has
the intended theme. Wrap the client subtree with `DesignSystemProvider` when the
selected theme can change.

```tsx
'use client';

import { DesignSystemProvider } from '@bap/design-system/theme';
import type { ReactNode } from 'react';

export function UiProvider({ children }: Readonly<{ children: ReactNode }>) {
  return <DesignSystemProvider theme="white">{children}</DesignSystemProvider>;
}
```

Persisted theme selection is application state. Validate it against the four
supported names before passing it to the provider.

## Composition

Prefer direct Carbon composition over BAP wrappers. Keep compound structures
intact: Tabs require their tab list and panels, DataTable requires table pieces,
ComposedModal requires header/body/footer, and UI Shell items require the shell
context described in the workbench.

A wrapper is justified only when at least two consumers require the same
non-product-specific behavior. `ChartFrame` exists for this reason: every chart
needs a title and equivalent table.

## Styling

Use Carbon components and semantic Sass tokens. Do not reach into Carbon's
private class structure. A local selector may arrange components, but it must
not recreate their internal states.

```scss
@use '@bap/design-system/tokens/layout' as layout;
@use '@bap/design-system/tokens/spacing' as spacing;
@use '@bap/design-system/tokens/theme' as theme;

.exampleSection {
  max-inline-size: layout.$container-05;
  padding-block: spacing.$spacing-07;
  color: theme.$text-primary;
}
```

If a Sass token name changes, catalog and compilation checks fail during the
same dependency upgrade.

## Feature flags and status

The pinned release enables v11 behavior and keeps v12 release behavior off.
Feature-flag stories are behavior evidence, not permission to turn on an
experimental flag globally. Use the workbench toolbar to inspect a flag. Any
product adoption needs an explicit compatibility decision and test.

Preview and unstable names are versioned APIs but may change. Keep them behind a
small local call site, document the reason for use, and add a migration test.
Deprecated aliases may be demonstrated for migration only and must not be added
to new code.

## Forms and validation

Use controlled state when application behavior depends on the current value.
Translate visible labels, helper text, error text, and component-supplied
strings. Validate user input at the application boundary, then set Carbon's
invalid or warning state and connect the message through the component API.

Disabled is not an error state. Prefer explaining why an action is unavailable
or omitting it when the user can never perform it. Use read-only when a value is
legitimate and inspectable but cannot be edited.

## Testing

For non-trivial UI, test:

- semantic role, name, description, and state;
- keyboard operation and focus destination;
- controlled state changes;
- loading, empty, error, and permission behavior;
- localization expansion;
- theme and reduced-motion behavior where custom styling exists;
- an axe scan of representative complex states.

Test user-observable behavior. Do not assert Carbon's private classes or copy
upstream unit tests.

## Workbench workflow

```bash
pnpm design-system:dev
pnpm design-system:test
pnpm design-system:build
```

Use the generated entry for the exact public export. If an export, prop, or
source mapping is missing, update the catalog or coverage registry instead of
adding an untracked story by hand.
