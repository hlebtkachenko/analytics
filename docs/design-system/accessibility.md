# Carbon Accessibility

The complete offline guide is
[Accessibility, internationalization, and content](knowledge-base/10-accessibility-i18n-content.md).
The adapted
[component definition of done](knowledge-base/09-component-definition-of-done.md)
defines the design, code, test, documentation, and assistive-technology release
gate. This page remains the compact repository contract.

## Required implementation rules

- Use Carbon components through `@bap/design-system` and keep their expected
  semantics and interaction behavior intact.
- Use native headings, landmarks, buttons, links, lists, tables, and form labels
  where Carbon does not provide a component.
- Ensure keyboard order follows document order and focus is always visible.
- Supply useful accessible names for icon-only controls and text alternatives
  for non-text content.
- Keep icons beside visible labels decorative and out of the focus order. Use
  Carbon's tooltip/label API for a justified icon-only control, and give every
  interactive icon a 44px mobile target.
- Do not identify a state or chart series by color alone.
- Keep Carbon focus styles and do not remove outlines.
- Support browser zoom, localization, and user font-size preferences.
- Respect reduced-motion preferences for custom motion.

## Charts

Every Carbon chart must have a descriptive title, `svgAriaLabel`, localized
labels, and a table equivalent. `ChartFrame` provides the table structure but
does not create chart options or data for the caller. Very small circular chart
slices can be unavailable to keyboard and tooltip interaction, so their table
equivalent is mandatory.

## Verification

The design-system checks verify theme synchronization, the chart-table fallback,
mode-specific full-facade parity, the exact curated 18-icon facade, generated
inventories, source coverage, and the static workbench. Before merging product
UI, add focused keyboard, VoiceOver, axe, localization, zoom, and reduced-motion
assertions for the actual interaction.

## Sources

- [Carbon accessibility overview](https://carbondesignsystem.com/guidelines/accessibility/overview/)
- [Carbon accessibility for developers](https://carbondesignsystem.com/guidelines/accessibility/developers/)
- [Carbon keyboard guidance](https://carbondesignsystem.com/guidelines/accessibility/keyboard/)
- [Carbon icon usage](https://carbondesignsystem.com/elements/icons/usage/)
- [Carbon icon code](https://carbondesignsystem.com/elements/icons/code/)
