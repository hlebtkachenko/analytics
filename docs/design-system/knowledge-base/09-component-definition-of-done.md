# Component Definition of Done

> Modified BAP checklist. Source:
> [Carbon component checklist](https://carbondesignsystem.com/contributing/component-checklist/)
> at website commit `df723531e56036f90bac8b1bbec7a0414a285063`. This adaptation
> is original BAP prose and adds repository-specific verification.

## When this checklist applies

Use this checklist for a BAP-owned reusable visual primitive, a material wrapper
around Carbon, or a proposed upstream Carbon contribution. Normal page
composition does not become a shared component merely to satisfy a checklist.

Stable means the design specification, code, tests, documentation, and design
asset agree. Preview means the component is useful but can still change.

## Design specification

### Configuration

- Every supported size, content configuration, orientation, theme, layer, and
  responsive behavior is specified.
- Unsupported combinations are explicit.
- The component uses Carbon tokens and grid relationships without magic values.

### Interaction states

- Enabled, hover, active, focus, selected, expanded, read-only, disabled,
  invalid, warning, loading, and skeleton states are included when applicable.
- Controlled and uncontrolled behavior is defined.
- Focus entry, movement, dismissal, and return are defined.

### Behavior

- Reflow, wrapping, truncation, scrolling, expansion, collision, and overflow
  behavior is specified from 320px upward.
- Async, empty, partial, success, and error behavior is specified.
- Localization expansion and RTL behavior are specified.

### Design accessibility

- Normal text meets at least 4.5:1 contrast, except documented inactive content.
- Interactive non-text elements and focus indicators meet at least 3:1.
- Accessible name, description, role, value, and state are specified.
- The component remains understandable without color, motion, or pointer input.

## API and implementation

### API principles

- Optimize the consumer experience, not implementation convenience.
- Compose logical public parts only when consumers need that flexibility.
- Prefer framework and standards interoperability.
- Deprecate before removal and document the migration.
- Keep the smallest API that supports defined variants.
- Validate only at user-input and external-data boundaries.

### Design-system boundary

- Application consumers import through `@bap/design-system`.
- A BAP wrapper has at least two real consumers or one mandatory cross-cutting
  behavior that cannot be supplied at call sites.
- No wrapper copies Carbon markup, internal class names, or state handling.

### Tokens and styling

- All colors, type, spacing, layout, layer, and motion values use Carbon roles.
- No private Carbon selector is a dependency.
- All four themes and supported layers are verified.
- Reduced motion has an equivalent non-motion state.

### Globalization

- Every visible string is supplied through props or application localization.
- Dates, numbers, units, lists, and plural forms are locale-aware.
- Layout tolerates expansion and direction change.

### Types and documentation

- Props, events, refs, compound parts, and public return types are exported.
- JSDoc explains constraints that TypeScript cannot express.
- Default and Playground stories exist.
- Usage, style, code, and accessibility guidance is local and source-attributed.

### Migration tooling

- A breaking rename or structural migration includes a codemod when mechanical
  conversion is safe and frequent enough to justify it.
- Deprecated names have replacement, release, and planned-removal information.

## Testing

### Unit and interaction

- Public behavior and supported props are covered with Testing Library.
- Functions, lines, statements, and branches meet or exceed 80% for a stable
  shared component unless a reviewed exception explains the gap.
- Controlled state, errors, async transitions, and focus behavior are tested.

### Visual regression

- The default story has a visual baseline.
- High-risk states, viewports, themes, overflow, and layer combinations have
  focused baselines.
- The suite does not snapshot every cartesian prop combination.

### Automated accessibility

- The default story and each materially different open, focused, expanded,
  selected, error, and modal state receive an axe check.
- Keyboard interaction is asserted separately; zero axe violations is not a
  complete accessibility result.

### Manual assistive-technology review

- Verify VoiceOver on macOS for BAP.
- For an upstream stable Carbon contribution, also follow Carbon's JAWS and NVDA
  expectations.
- Record browser, screen reader, version, commands, result, and known
  limitation.

## Documentation

### Usage

- Explain the problem the component solves, when to use it, and when not to use
  it.
- Describe selection among variants and related components.

### Style

- Record anatomy, size, spacing, tokens, themes, layers, responsive behavior,
  and content limits.

### Code

- Provide a minimal valid BAP-facade example, dependencies, client/server
  boundary, controlled state, and migration notes.

### Documentation accessibility

- Record semantics, names, descriptions, keyboard model, focus, announcements,
  errors, zoom, contrast, and assistive-technology results.

## Design asset

When a distributable design asset exists, it must match the implementation, use
consistent naming and component properties, include auto layout, and represent
every supported state. IBM-only Figma assets cannot be copied into this public
repository. Record the external source and access limitation.

## BAP release gate

- Catalog and source-coverage checks pass.
- No unknown export or undocumented status exists.
- Static workbench build succeeds offline.
- Browser, keyboard, accessibility, type, lint, and build checks pass.
- License and modified-work attribution are current.
- No realistic business, customer, employee, financial, or operational data is
  present in fixtures, screenshots, or logs.
- A focused review finds no high-severity issue.

## Review record template

```text
Component:
Status:
Owner:
Carbon source/version:
Supported variants:
Excluded combinations and reasons:
Keyboard result:
Automated accessibility result:
Manual assistive-technology result:
Visual result:
Localization result:
Migration risk:
Reviewer and date:
```
