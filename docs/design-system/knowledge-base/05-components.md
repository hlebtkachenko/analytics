# Components, Composition, States, and Status

> Modified BAP guidance. Sources: Carbon component usage, style, code, and
> accessibility pages at website commit
> `df723531e56036f90bac8b1bbec7a0414a285063`; API status and composition come
> from Carbon React tag `v11.115.0`. This chapter is original BAP prose.

## Catalog contract

The generated API index and workbench are the exhaustive inventory. They
classify every root export and recursively exposed namespace member. This
chapter is the selection guide for primary families and their compound parts.

Statuses mean:

| Status                  | Use                                                                             |
| ----------------------- | ------------------------------------------------------------------------------- |
| Stable                  | Default choice for product code                                                 |
| Preview                 | Usable with an explicit change-risk note and focused tests                      |
| Unstable                | Inspect and experiment; adoption requires a migration boundary                  |
| Deprecated              | Migration reference only; do not add to new code                                |
| Feature flagged         | Behavior depends on a named pinned flag and must be tested both ways if adopted |
| Internal or source-only | Not a BAP public API even if a source folder or upstream story exists           |

Aliases receive their own catalog entries but point to one canonical fixture.
This preserves searchability without suggesting that aliases are different
components.

## Universal state model

For each interactive component, inspect applicable states: enabled, hover,
active, focus, selected, expanded, invalid, warning, read-only, disabled,
loading, skeleton, and AI presence. Also inspect controlled and uncontrolled
modes, optional content, localization expansion, theme, layer, viewport, and
reduced motion.

The props define which states are valid. Do not manufacture a state that the
component does not expose.

## Layout and provider components

| Component                                                                  | Selection and composition guidance                                                                                            |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `Grid`, `Column`, `Row`, `FlexGrid`, `ColumnHang`                          | Responsive page and region structure. Prefer current CSS Grid primitives; treat legacy helpers according to generated status. |
| `Stack`, `HStack`, `VStack`                                                | Token-aligned spacing among related children. Do not use for page-column behavior.                                            |
| `AspectRatio`                                                              | Preserve a meaningful media or box ratio.                                                                                     |
| `Layer`, `useLayer`                                                        | Apply the next semantic surface context. Nest instead of selecting a numeric layer token manually.                            |
| `Theme`, `GlobalTheme`, `ThemeContext`, `useTheme`, `usePrefersDarkScheme` | Establish global or local theme context. BAP's root uses `DesignSystemProvider`.                                              |
| `Heading`, `Section`                                                       | Keep semantic heading hierarchy while allowing nested sections.                                                               |
| `ClassPrefix`, `PrefixContext`, `usePrefix`                                | Prefix integration support. Applications normally use the configured default.                                                 |
| `IdPrefix`, `useIdPrefix`                                                  | Avoid identifier collisions in embedded or repeated roots.                                                                    |
| `LayoutDirection`, `useLayoutDirection`                                    | Preview/unstable direction context. Prefer standards-based `dir` unless this API is specifically required.                    |
| `Portal`                                                                   | Render overlays in the intended document location. Verify focus and stacking context.                                         |
| `Content`                                                                  | UI Shell content region. Use only inside a coherent shell.                                                                    |

## Accordion and disclosure

`Accordion`, `AccordionItem`, and `AccordionSkeleton` reveal sections in a
compact vertical structure. Use headings that describe hidden content. Do not
use an accordion when all content must be compared at once. Test single and
multiple expansion, disabled items, heading levels, icon position, size, and
keyboard navigation.

`Disclosure` is source-visible but must be treated according to the generated
public-export status. Do not import a source folder directly.

## Breadcrumb

`Breadcrumb`, `BreadcrumbItem`, and `BreadcrumbSkeleton` show hierarchy, not
browser history. The current location is last and is not a duplicate action.
Test truncation, overflow, long labels, and narrow viewports.

## Buttons and direct actions

| Export                                             | Use                                                                                                            |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `Button`                                           | General action with `primary`, `secondary`, `tertiary`, `ghost`, and danger kinds exposed by the pinned types. |
| `PrimaryButton`, `SecondaryButton`, `DangerButton` | Convenience exports. Keep action hierarchy consistent with `Button`.                                           |
| `IconButton`                                       | Icon-only or icon-led compact action with an accessible label and adequate target.                             |
| `ButtonSet`                                        | Visually related actions, commonly in a dialog footer.                                                         |
| `Copy`, `CopyButton`                               | Copy a known value and announce completion.                                                                    |
| `ComboButton`                                      | Primary action plus related alternatives.                                                                      |
| `MenuButton`                                       | Opens a menu of actions without a separate primary action.                                                     |

Only one action should carry primary emphasis in a decision area. Destructive
actions need explicit labels and, when consequences cannot be reversed, a
confirmation pattern.

## Checkbox and radio controls

`Checkbox`, `CheckboxGroup`, `CheckboxSkeleton`, and `InlineCheckbox` support
independent selections, including an indeterminate parent state. A group label
must explain the shared question.

`RadioButton`, `RadioButtonGroup`, `RadioButtonSkeleton`, and `RadioTile`
support one choice from a known set. Do not use radio buttons when no initial
choice is acceptable unless a clear unselected state is part of the task.

Test label wrapping, invalid and read-only states, keyboard arrow movement,
controlled values, and group-level errors.

## Select, Dropdown, ComboBox, and MultiSelect

| Family                                                         | Choose when                                                                                                                                    |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `Select`, `SelectItem`, `SelectItemGroup`, `SelectSkeleton`    | Native-like compact selection from a short stable list.                                                                                        |
| `Dropdown`, `DropdownSkeleton`                                 | A custom single-selection list needs Carbon presentation or richer item rendering.                                                             |
| `ComboBox`                                                     | The user can filter or enter against a list.                                                                                                   |
| `MultiSelect`, `FilterableMultiSelect`                         | More than one option can be selected.                                                                                                          |
| `ListBox` and its field, menu, item, icon, and selection parts | Compound internals exposed for supported composition. Prefer the complete controls above unless a documented public composition requires them. |

Specify the item key, display text, initial selection, empty result, invalid
state, and translation strings. Test keyboard traversal, type-ahead, clearing,
controlled selection, long lists, and menu placement.

## Text, numeric, search, date, and time input

| Family                                                                       | Important variants and states                                                           |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `TextInput`, `ControlledPasswordInput`, `PasswordInput`, `TextInputSkeleton` | Size, type, helper text, invalid/warn, read-only, disabled, show-password behavior.     |
| `TextArea`, `TextAreaSkeleton`                                               | Character count, resize, long content, invalid/warn, read-only.                         |
| `NumberInput`, `NumberInputSkeleton`, `validateNumberSeparators`             | Locale-aware separator, min/max/step, button operation, invalid input.                  |
| `Search`, `ExpandableSearch`, `SearchSkeleton`                               | Persistent or expandable discovery input, clear action, controlled query.               |
| `Slider`, `SliderSkeleton`                                                   | Bounded approximate value, optional input, min/max/step, keyboard increments.           |
| `DatePicker`, `DatePickerInput`, `DatePickerSkeleton`                        | Single, simple, or range behavior, locale, format, min/max, calendar keyboard behavior. |
| `TimePicker`, `TimePickerSelect`                                             | Time entry plus optional period or zone selection.                                      |
| `Toggle`, `ToggleSkeleton`, `ToggleSmallSkeleton`                            | Immediate binary setting with explicit on/off labels.                                   |
| `Switch`, `IconSwitch`                                                       | Content-switcher child, not a settings toggle.                                          |

Labels are always visible unless the component's documented compact behavior
provides an equivalent accessible name. Placeholder text is not a label.

## Fluid form controls

Fluid controls reserve space for labels, helper text, and validation while
supporting dense compositions. The pinned release exports `FluidForm`,
`FluidComboBox`, `FluidDatePicker`, `FluidDatePickerInput`, `FluidDropdown`,
`FluidMultiSelect`, `FluidNumberInput`, `FluidPasswordInput`, `FluidSearch`,
`FluidSelect`, `FluidTextArea`, `FluidTextInput`, `FluidTimePicker`, and
`FluidTimePickerSelect`, plus their available skeletons.

Many names retain preview and unstable aliases for compatibility. Use the
canonical stable name when the generated status marks it stable. Do not mix
fluid and non-fluid controls in one aligned form row without a deliberate layout
specification.

## Form structure

`Form`, `FluidForm`, `FormGroup`, `FormItem`, `FormLabel`, and `FormContext`
provide grouping and shared layout. Native form submission and validation
boundaries remain application responsibilities. Associate group instructions and
errors with their controls, and place the first invalid focus deliberately.

## File upload

`FileUploader`, `FileUploaderButton`, `FileUploaderDropContainer`,
`FileUploaderItem`, `FileUploaderSkeleton`, and `Filename` cover selection,
drag-and-drop, queue state, success, error, and removal.

Application code must validate file type, size, count, and server response. A
file name is untrusted text. Show progress and recovery without exposing local
paths or backend details.

## Content switcher and tabs

`ContentSwitcher` with `Switch` or `IconSwitch` swaps related content in the
same context. It is not global navigation.

Current tabs use `Tabs`, `TabList`, `Tab`, `IconTab`, `TabPanels`, and
`TabPanel`; vertical forms use `TabsVertical` and `TabListVertical`. Legacy
`TabContent` and older composition surfaces remain cataloged according to their
status. Preserve tab-to-panel relationships, roving focus, selected state, and
content persistence decisions.

## Links and navigation

`Link` navigates to a resource. A button performs an action. Do not style one as
the other. Indicate external behavior in accessible text when opening a new
context.

`Pagination`, `PaginationNav`, `PaginationSkeleton`, and preview
`PageSelector`/`Pagination` APIs move through a known result set. Localize item
counts and page labels. Preserve the current page and focus when results change.

## UI Shell

UI Shell exports include `Header`, `HeaderContainer`, `HeaderName`,
`HeaderNavigation`, `HeaderMenu`, `HeaderMenuItem`, `HeaderMenuButton`,
`HeaderGlobalBar`, `HeaderGlobalAction`, `HeaderPanel`, `HeaderSideNavItems`,
`SideNav`, `SideNavItems`, `SideNavItem`, `SideNavLink`, `SideNavLinkText`,
`SideNavMenu`, `SideNavMenuItem`, `SideNavIcon`, `SideNavDivider`,
`SideNavHeader`, `SideNavDetails`, `SideNavFooter`, `SideNavSwitcher`,
`Switcher`, `SwitcherItem`, `SwitcherDivider`, and `SkipToContent`.

Use the [global header pattern](06-patterns.md#global-header) before composing a
shell. Navigation ownership, responsive collapse, active item, focus movement,
skip target, and overflow must be defined together. Do not assemble shell pieces
as decorative chrome.

## Menu, overflow, and context actions

`Menu` composes `MenuItem`, `MenuItemDivider`, `MenuItemGroup`,
`MenuItemRadioGroup`, and `MenuItemSelectable`. `OverflowMenu` and
`OverflowMenuItem` expose secondary contextual actions. `useContextMenu` anchors
a menu to a context interaction.

Keep the most important action visible. Group and order menu items consistently,
show destructive actions last, and support Escape, arrow navigation, activation,
focus return, and viewport collision.

`OverflowMenuV2` is preview/unstable in the pinned release. Its generated entry
must stay separate from the stable menu path.

## Lists and structured content

`OrderedList`, `UnorderedList`, and `ListItem` express semantic lists.
`ContainedList` and `ContainedListItem` present a bounded set whose rows may
have actions. Structured List composes `StructuredListWrapper`,
`StructuredListHead`, `StructuredListBody`, `StructuredListRow`,
`StructuredListCell`, `StructuredListInput`, and `StructuredListSkeleton`.

Use a DataTable when columns need sorting, selection, expansion, or data-table
semantics. Use a Structured List for simpler aligned comparison.

## DataTable

`DataTable` coordinates `TableContainer`, `Table`, `TableHead`, `TableBody`,
`TableRow`, `TableHeader`, `TableCell`, selection cells, expansion rows,
decorator rows, toolbar pieces, batch actions, and `DataTableSkeleton`.

Define columns, row identifiers, sorting, selection scope, expansion ownership,
batch actions, filtering, pagination, empty state, loading state, and missing
values. Use header scopes and preserve keyboard access. Virtualization is an
application concern and must retain table semantics.

`TableSlugRow` is a compatibility name related to AI labeling. Prefer the
current AI label terminology.

## CodeSnippet

`CodeSnippet` and `CodeSnippetSkeleton` present inline, single-line, or
multi-line code with optional copy behavior. Do not use them as an editor or
syntax highlighter. Preserve whitespace and provide a language-neutral label for
the copy result.

## Tiles

`Tile`, `ClickableTile`, `SelectableTile`, `RadioTile`, `ExpandableTile`,
`TileGroup`, `TileAboveTheFoldContent`, and `TileBelowTheFoldContent` cover
static containers and interactive selection or disclosure.

Choose one interaction model per tile. A clickable tile is a single action; do
not place conflicting nested controls inside it. Contrast and radio-icon
behavior are feature-flagged in the pinned release and require explicit
workbench inspection.

## Tags and indicators

`Tag`, `DismissibleTag`, `SelectableTag`, `OperationalTag`, and `TagSkeleton`
represent a compact category, filter, status, or removable token. Do not encode
critical state by tag color alone. Give dismiss and select interactions clear
names.

`IconIndicator`, `ShapeIndicator`, and `BadgeIndicator` are status-sensitive or
preview surfaces. Use their generated status and pair symbols with accessible
text.

## Popover, tooltip, and toggletip

`Popover` and `PopoverContent` hold richer contextual content. `Tooltip` and
`DefinitionTooltip` provide concise, non-essential explanation. Toggletip
composes `Toggletip`, `ToggletipButton`, `ToggletipContent`, `ToggletipLabel`,
and `ToggletipActions` for interactive disclosed help.

Never hide information required to complete a task in a hover-only tooltip. Test
pointer, keyboard, touch, Escape, focus movement, placement, and zoom.

## Modal and dialog

`Modal` is a complete dialog. `ComposedModal` combines `ModalHeader`,
`ModalBody`, and `ModalFooter`; presence helpers include `ModalPresence`,
`ComposedModalPresence`, `withModalPresence`, and `withComposedModalPresence`.
`ModalWrapper` remains a compatibility surface.

Use the [dialog pattern](06-patterns.md#dialogs) to choose transactional,
passive, or dangerous behavior. Give the dialog a label, constrain actions, trap
focus while open, and return focus to a logical trigger.

`preview__Dialog` and preview/unstable PageHeader namespaces are separate APIs.
Keep them visibly warned.

## Notifications

`InlineNotification`, `ToastNotification`, `ActionableNotification`,
`StaticNotification`, `NotificationActionButton`, and `NotificationButton` cover
feedback with different urgency, persistence, and action models.

Choose notification type from the
[notification pattern](06-patterns.md#notifications). Do not use toasts for
information that must remain available. Localize status labels and ensure
announcements do not interrupt more than urgency requires.

## Loading and progress

`Loading` signals indeterminate blocking work. `InlineLoading` communicates an
inline active, success, error, or inactive state. `ProgressBar` shows measurable
progress. `ProgressIndicator` and `ProgressStep` show steps in a process.

Use skeletons when the page structure is known. Preserve layout to avoid jumps
and expose a textual status when visual animation is not perceivable.

## Skeletons

The package exports family skeletons plus `SkeletonText`, `SkeletonIcon`,
`IconSkeleton`, and `SkeletonPlaceholder`. Match the expected content shape and
do not render skeleton and live content simultaneously to assistive technology.
Respect reduced motion.

## TreeView

`TreeView` and `TreeNode` represent hierarchical items with expandable branches.
Specify selection model, expansion ownership, labels, loading of children, and
arrow-key behavior. Do not use a tree for a flat navigation list.

## ErrorBoundary

`ErrorBoundary`, `ErrorBoundaryContext`, and `Callout` support a contained
rendering fallback. They do not replace route-level error handling, logging, or
recovery design. Give users a meaningful next action without exposing stack
details.

## AI components

`AILabel`, `AILabelContent`, `AILabelActions`, `AISkeletonText`,
`AISkeletonIcon`, and `AISkeletonPlaceholder` identify AI presence and provide
explainability. `ChatButton` and its skeleton are preview/unstable. Older `Slug`
and `AiSkeleton` aliases exist for compatibility and are not preferred names.
Follow the dedicated [Carbon for AI chapter](07-carbon-for-ai.md).

## Preview namespace components

The pinned release exposes namespace objects for Card, DatePicker, Dialog, and
PageHeader, plus prefixed aliases for other preview and unstable APIs. Namespace
members are individually indexed, because `preview__Card.Card` is a renderable
surface even though the namespace object is not.

Never infer status from capitalization. Use generated metadata from the exact
declaration and runtime mode.

## Non-renderable exports

Constants such as `ButtonKinds`, hooks, contexts, validation helpers, presence
HOCs, and translation identifiers are valid public APIs but are not standalone
stories. Their catalog entries state why they are non-renderable and link to a
consumer component or provider example.

## Component implementation template

```tsx
'use client';

import { Form, FormGroup, Stack, TextInput } from '@bap/design-system/react';

export function NeutralForm() {
  return (
    <Form aria-label="Example form">
      <Stack gap={6}>
        <FormGroup legendText="Example group">
          <TextInput id="example-value" labelText="Value" />
        </FormGroup>
      </Stack>
    </Form>
  );
}
```

The fixture intentionally has no submission or product meaning. Product code
adds validation, localized strings, and a defined completion action.
