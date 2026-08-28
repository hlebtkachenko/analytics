# Carbon Accessibility

Carbon components follow the IBM accessibility checklist, which aligns with WCAG
AA, Section 508, and European standards. This does not make a product
automatically accessible: BAP code must preserve semantic structure, labels,
focus order, and equivalent information.

## Required implementation rules

- Use Carbon components through `@bap/design-system` and keep their expected
  semantics and interaction behavior intact.
- Use native headings, landmarks, buttons, links, lists, tables, and form labels
  where Carbon does not provide a component.
- Ensure keyboard order follows document order and focus is always visible.
- Supply useful accessible names for icon-only controls and text alternatives
  for non-text content.
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

The design-system tests verify theme synchronization, the chart-table fallback,
and pinned export inventories. The web reference page verifies the client facade
under Next App Router. Before merging product UI, add focused keyboard,
screen-reader, and axe assertions for the actual interaction.

## Sources

- [Carbon accessibility overview](https://carbondesignsystem.com/guidelines/accessibility/overview/)
- [Carbon accessibility for developers](https://carbondesignsystem.com/guidelines/accessibility/developers/)
- [Carbon keyboard guidance](https://carbondesignsystem.com/guidelines/accessibility/keyboard/)
