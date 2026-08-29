# Carbon Core Patterns

> Modified BAP guidance. Sources: all 18 files under `src/pages/patterns` at
> Carbon website commit `df723531e56036f90bac8b1bbec7a0414a285063`. This is
> original BAP prose. It records composition decisions without copying upstream
> diagrams or examples.

## Patterns overview

Patterns describe reusable ways to complete goals. They are not installable
components. A runnable specimen is appropriate only when a neutral composition
can demonstrate the interaction without inventing product logic.

Each pattern below records its source-page treatment and workbench expectation.

## Common actions

Keep equivalent actions in equivalent locations and use consistent labels.
Primary, secondary, cancel, destructive, overflow, and batch actions need a
stable hierarchy. A neutral ButtonSet and overflow-menu specimen can run
locally; actual action availability remains product logic.

## Dialogs

Use a dialog when a workflow must pause for focused input or urgent information.
Choose Modal for the standard contract and ComposedModal when header, body, and
footer composition is required. Specify trigger, initial focus, validation,
completion, cancellation, dangerous consequences, Escape behavior, and focus
return. The workbench provides neutral transactional and passive compositions.

## Disabled states

Disabled removes interaction. It should not hide a permission problem, loading
state, or validation error. Keep essential explanation available and avoid
disabled controls that users cannot understand. A component-state matrix is
runnable; permission decisions are documentation-only.

## Disclosures

Reveal supporting content without losing context. Accordion, expandable Tile,
Toggletip, expandable DataTable rows, and TreeView have different semantic and
focus contracts. Use the smallest disclosure that matches the content
relationship. Runnable specimens cover each public mechanism.

## Empty states

Explain why content is absent and identify the next meaningful action when one
exists. Distinguish first use, no results, cleared data, error, and permission
states. A neutral ContainedList or DataTable empty composition can run locally;
the correct message and action require product context.

## Filtering

Show the relationship between criteria and the visible result set. Make active
filters reviewable and reversible, preserve keyboard order, and announce result
changes without excessive interruption. Dropdown, MultiSelect, Search, Tag, and
DataTable can form the specimen. Query semantics remain application-owned.

## Fluid styles

Use fluid form controls when their integrated label, helper, and validation
layout benefits a dense or aligned form. Keep one coherent control style within
a group and test label expansion. The workbench compares fluid and standard
families using neutral labels.

## Forms

Group fields around a user goal, not a storage schema. Mark required and
optional values consistently, validate at the right boundary, preserve entered
data after errors, and focus a useful error location. A neutral multi-control
form can run locally; submission behavior is excluded until requirements exist.

## Global header

The header establishes product identity, global navigation, global actions, and
responsive access to side navigation. Use UI Shell pieces as one system. Define
active state, skip target, responsive collapse, menu ownership, focus order, and
overflow. The workbench can demonstrate shell mechanics but must not invent BAP
navigation information architecture.

## Loading

Use Loading for indeterminate blocking work, InlineLoading for local status,
ProgressBar for measurable work, ProgressIndicator for steps, and skeletons for
known content structure. Avoid animation with no status text or an indefinite
spinner when a failure state is known. Runnable specimens include reduced
motion.

## Login

Login requires authentication, recovery, error, rate-limit, and session
requirements. Carbon components can implement the form, but the workbench must
not fabricate an authentication flow or sample identities. This pattern is
documentation-only until a real login requirement defines behavior.

## Notifications

Choose inline feedback for local context, toast for brief non-blocking feedback,
actionable notification when a meaningful recovery action exists, and static
notification when information must persist. Define urgency, announcement,
dismissal, lifetime, and history. Neutral variants can run locally.

## Overflow content

Prefer reflow, wrapping, truncation with accessible expansion, scrolling, or a
menu according to the content. Do not clip focusable content. Test zoom, long
translations, narrow viewports, and tooltip accessibility. The workbench uses
neutral strings to demonstrate each supported overflow mechanism.

## Read-only states

Read-only content is valid and reviewable but cannot be edited. It remains
focusable when users need selection, copy, or context. It is not visually or
semantically disabled. Runnable form specimens compare read-only and disabled
states.

## Search

Search is a discovery flow, not only an input. Define scope, submit behavior,
suggestions, recent values, clearing, loading, no results, errors, and result
announcement. The workbench demonstrates Search and ExpandableSearch mechanics;
result relevance remains product logic.

## Status indicators

Communicate status with text and shape or icon in addition to color. Use Tag,
InlineNotification, ProgressBar, BadgeIndicator, IconIndicator, or
ShapeIndicator according to persistence and meaning. Standardize vocabulary
before colors. Neutral component variants can run locally.

## Text toolbar

A text toolbar groups formatting commands around an editor selection. Define
which commands apply, pressed state, shortcuts, overflow, focus movement, and
screen-reader feedback. Carbon provides buttons, menus, tooltips, and content
switchers, but no BAP editor is in scope. The pattern remains documentation-only
until an editor requirement exists.

## Source-page coverage

The upstream pattern directory has 18 MDX pages: this overview plus the 17
sections above. The [website coverage artifact](coverage-website.md) maps every
path to a unique local record and this chapter heading.
