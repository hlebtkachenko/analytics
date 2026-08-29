# Carbon Offline Knowledge Base

This handbook is the offline operating guide for the Carbon Core release pinned
by BAP. It explains how to choose and compose the installed APIs, then points to
the generated workbench for executable details. Online links establish
provenance; they are not required for day-to-day implementation.

## Release boundary

- Carbon React `1.115.0`, source tag `v11.115.0`, commit
  `7518c84ffd00f22434fe19d83119692c12fccb2f`.
- Carbon Charts React `1.27.18`, source tag `v1.27.18`, commit
  `abd30134f12462c9215a823543fdda56779719e6`.
- Carbon website evidence at commit `df723531e56036f90bac8b1bbec7a0414a285063`.
- Exact secondary package versions are maintained in `pnpm-workspace.yaml` and
  recorded by the generated catalog.

## Chapters

1. [Orientation and adoption boundary](01-orientation.md)
2. [Designing workflow](02-designing.md)
3. [Developing with Next App Router](03-developing.md)
4. [Foundations and tokens](04-foundations.md)
5. [Components, composition, states, and status](05-components.md)
6. [Carbon Core patterns](06-patterns.md)
7. [Carbon for AI](07-carbon-for-ai.md)
8. [Data visualization, Charts, and diagrams](08-data-visualization.md)
9. [Component definition of done](09-component-definition-of-done.md)
10. [Accessibility, internationalization, and content](10-accessibility-i18n-content.md)
11. [Contribution, upgrades, provenance, and licensing](11-contribution-upgrades.md)

## Closed-world coverage

- [Coverage method and totals](source-coverage.md)
- [147 React story files and 547 named stories](coverage-react-stories.md)
- [198 React-package MDX sources](coverage-react-mdx.md)
- [317 Carbon website MDX sources](coverage-website.md)

Every adapted chapter is original BAP prose. Each chapter identifies its
official inputs and is marked as modified. The coverage documents contain paths,
identifiers, classifications, and local mappings only; they do not reproduce
upstream documentation or implementation source.

## Reproducing pinned source coverage

Ordinary CI verifies committed coverage artifacts only and never fetches source.
To independently check the pinned input inventory, use three clean checkout
roots with no untracked files or symlinks. The command verifies the exact
commits, checkout roots, package version, source-path sets, and reviewed record
metadata.

```bash
cd apps/design-system-workbench
node scripts/refresh-documentation-coverage.mjs \
  --carbon-react "$BAP_CARBON_REACT_ROOT" \
  --carbon-website "$BAP_CARBON_WEBSITE_ROOT" \
  --carbon-charts "$BAP_CARBON_CHARTS_ROOT" \
  --check
```

The three coverage tables are reviewed classification inputs. When a pin
changes, add or remove source records deliberately, explain every
classification, then run the same command with `--update` to refresh the
deterministic digest manifest. Run `--check` afterward to prove the committed
manifest is byte-current. Neither mode invents a status, reason, or target for
new upstream material.

## How to use this handbook

Start with orientation, then use the component or chart chapter as a decision
guide. Open the local Storybook workbench when exact props, variants, or live
behavior matter. Generated API data wins over a prose statement if a pinned
package upgrade changes the surface. Record and fix the discrepancy in the same
change.

## Source and modification notice

Modified BAP documentation derived from the Carbon Design System and Carbon
Charts projects. Carbon package source is Apache-2.0 licensed. IBM Plex is
OFL-1.1 licensed. IBM, Carbon, and IBM Plex are marks of their respective
owners. BAP is not affiliated with or endorsed by IBM.
