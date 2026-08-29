# Foundation Tool Decisions

The decisions below compare each proposed tool with Carbon and the implemented
foundation. A dependency is added only when a real current consumer exists.

| Need                      | Decision                          | Rationale                                                                                                                                                                        |
| ------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Components and layout     | Use `@carbon/react`               | It is BAP's sole component and layout system.                                                                                                                                    |
| Standard charts           | Use `@carbon/charts-react`        | It is the sole standard chart library and is exposed through `@bap/design-system/charts`.                                                                                        |
| Large virtualized lists   | Use `@tanstack/react-virtual`     | The complete local Carbon explorers now have a real dense-list consumer: thousands of icons and pictograms. Product tables still default to Carbon pagination.                   |
| Localization              | Use `i18next` and `react-i18next` | Real sign-in and organization-access strings now exist. The supported locale is intentionally `en-US` only.                                                                      |
| Date calculations         | Defer `@internationalized/date`   | No date feature exists. Date-only values will use `YYYY-MM-DD`, instants use UTC ISO-8601/PostgreSQL `timestamptz`, and schedules require an IANA zone plus explicit DST policy. |
| Keyboard shortcuts        | Defer `react-hotkeys-hook`        | Carbon owns component keyboard behavior. A future command surface must justify and scope global shortcuts.                                                                       |
| SQL and JSON highlighting | Defer `prism-react-renderer`      | Carbon CodeSnippet covers current accessible code display; no syntax artifact exists.                                                                                            |
| Conditional classes       | Reject `clsx` now                 | Carbon accepts `className`, while BAP styling uses Carbon Sass and tokens.                                                                                                       |
| Developer assertions      | Reject `tiny-invariant`           | Zod validates boundaries and TypeScript/local exhaustive checks cover internal invariants.                                                                                       |
| Component workbench       | Use Storybook                     | A local static catalog now needs switchable themes, controls, viewports, accessibility checks, interaction fixtures, and offline documentation.                                  |
| Offline knowledge search  | Use `minisearch`                  | The complete local Carbon knowledge base needs bundled search without a hosted index or runtime network dependency.                                                              |

No competing design system, utility CSS framework, second chart library, or
copied Carbon implementation is permitted.
