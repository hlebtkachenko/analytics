# Contribution, Upgrades, Provenance, and Licensing

> Modified BAP guidance. Sources: Carbon contributing, migration, release,
> repository, and package-license materials frozen at the three commits listed
> below. This chapter is original BAP prose.

## Source pins

| Source          | Pin                                                                | Purpose                                                                              |
| --------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Carbon monorepo | tag `v11.115.0`, commit `7518c84ffd00f22434fe19d83119692c12fccb2f` | React, styles, icons, pictograms, tokens, stories, and package MDX                   |
| Carbon website  | commit `df723531e56036f90bac8b1bbec7a0414a285063`                  | Design, usage, accessibility, pattern, data-visualization, and contribution guidance |
| Carbon Charts   | tag `v1.27.18`, commit `abd30134f12462c9215a823543fdda56779719e6`  | Installed chart and diagram package source, declarations, and runtime verification   |

The source-coverage artifacts are tied to these pins. A new dependency version
requires new source pins and a deliberate refresh.

## Contributing a BAP composition

For page-specific UI:

1. Define the product requirement and states.
2. Select a stable Carbon pattern and components.
3. Import only through BAP facades.
4. Add focused behavior and accessibility tests.
5. Update local documentation if a reusable rule changes.

Do not add a shared design-system component for a single page arrangement.

## Contributing a shared primitive

Before creating a BAP wrapper, document the gap in Carbon, the consumers, the
required API, and why composition at call sites is insufficient. Follow the
[component definition of done](09-component-definition-of-done.md). Keep the
wrapper free of business terms and data.

Consider an upstream Carbon contribution when the problem is universal. Follow
Carbon's issue, design specification, review, test, Storybook, documentation,
and migration process in the upstream repository. Do not copy a local patch of
Carbon into BAP as a long-term substitute.

## Upgrade workflow

1. Read release notes and migration guidance for every changed Carbon package.
2. Update exact workspace catalog versions and the lockfile together.
3. Freeze matching Carbon, Carbon website, and Carbon Charts commits or tags.
4. Run the catalog generator and review every added, removed, renamed, status,
   prop, flag, token, icon, pictogram, chart, and Sass change.
5. Refresh closed-world source indexes and explain each classification change.
6. Regenerate committed workbench entries and local search data.
7. Update original handbook guidance only where behavior or policy changed.
8. Run facade parity, Sass compilation, Storybook build, offline, browser,
   keyboard, accessibility, license, leak, and repository gates.
9. Review preview, unstable, deprecated, and feature-flag usage manually.
10. Commit the upgrade and generated evidence as one reviewable change set.

Never fix a generated mismatch by changing an expected count alone.

## Refresh commands

```bash
pnpm install --frozen-lockfile
pnpm design-system:catalog
pnpm design-system:catalog:check
pnpm design-system:test
pnpm design-system:build
pnpm design-system:test:browser
pnpm check
```

The catalog update command changes committed generated artifacts. Catalog check
mode must remain read-only and fail on drift.

## Closed-world source refresh

With `BAP_CARBON_REACT_ROOT`, `BAP_CARBON_WEBSITE_ROOT`, and
`BAP_CARBON_CHARTS_ROOT` set to clean absolute checkout roots, run:

```bash
cd apps/design-system-workbench
node scripts/refresh-documentation-coverage.mjs \
  --carbon-react "$BAP_CARBON_REACT_ROOT" \
  --carbon-website "$BAP_CARBON_WEBSITE_ROOT" \
  --carbon-charts "$BAP_CARBON_CHARTS_ROOT" \
  --update
node scripts/refresh-documentation-coverage.mjs \
  --carbon-react "$BAP_CARBON_REACT_ROOT" \
  --carbon-website "$BAP_CARBON_WEBSITE_ROOT" \
  --carbon-charts "$BAP_CARBON_CHARTS_ROOT" \
  --check
```

The refresh verifier rejects dirty or untracked checkouts, symlinks, paths that
escape a checkout, duplicate paths, and a supplied subdirectory instead of a git
root. It verifies 198 React MDX files, 317 website MDX files, 147 story files,
and 547 AST-declared names.

The coverage Markdown tables are the reviewed classification inputs. A source
upgrade must add, remove, or reclassify rows deliberately. The update command
refuses incomplete source sets and writes only the deterministic digest
manifest; it never invents a status, reason, or target. The following check
command is read-only and proves the manifest is byte-current.

For each source pin:

- enumerate the exact React story and MDX files;
- parse named story declarations with the TypeScript compiler;
- enumerate website MDX files;
- assign every record one of `included`, `summarized`, `superseded`, or
  `excluded`;
- provide a nonempty reason and unique local target anchor;
- fail when a source disappears, appears, duplicates an identifier, maps to a
  missing anchor, or uses an unknown status.

An excluded record remains in the artifact. Exclusion is part of coverage, not
an instruction to forget the source.

## Modified-work attribution

Each handbook chapter states that it is modified, names the upstream sources,
and identifies the pin. Coverage artifacts store source paths and classification
metadata only. Do not bulk-copy upstream prose, code, screenshots, diagrams, or
images.

When a short adapted excerpt is genuinely needed, preserve its license notice,
mark changes, attribute the exact source, and keep the excerpt no longer than
necessary. Prefer an original explanation and executable local example.

## Licenses and notices

- Carbon React, Carbon Charts, Carbon Icons, and Carbon Pictograms are
  Apache-2.0 licensed.
- IBM Plex is OFL-1.1 licensed.
- Storybook and other workbench dependencies retain their package licenses.
- Repository notices must record exact packages and redistributed artifacts.
- Website content licensing must be verified before any direct reproduction;
  this handbook avoids reproduction.

IBM, Carbon, and IBM Plex are marks of their respective owners. BAP is not
affiliated with or endorsed by IBM.

## Telemetry and network behavior

Some IBM packages include installation telemetry hooks. BAP's package-manager
policy blocks their lifecycle scripts, and build environments disable IBM and
Next telemetry. Storybook telemetry is disabled in config and through its
documented environment switch. The static workbench must not load remote
documentation, analytics, fonts, images, or source code.

## Review requirements

Before delivery:

- run the component definition-of-done checks that apply;
- inspect generated diffs for false stable or renderable classifications;
- verify all relative links and anchors;
- confirm every source record has a status, reason, and unique target;
- scan fixtures and static output for sensitive or realistic data;
- review license and attribution changes;
- perform focused code, accessibility, and security review;
- leave the Phase 5 pull request unmerged unless the owner explicitly changes
  that boundary.

## Known limits

- Restricted IBM-only Figma libraries are referenced but not redistributed.
- Carbon extensions are not covered as Carbon Core.
- Manual screen-reader results cannot be generated from static source analysis.
- A closed-world artifact proves coverage of the pinned inputs, not future
  releases.
- Charts provenance verifies the installed package boundary. It does not claim
  an exhaustive Carbon Charts website documentation or example inventory.
- The handbook explains supported choices; generated declarations remain the
  exhaustive prop and token reference.
