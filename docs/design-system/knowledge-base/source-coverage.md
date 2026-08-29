# Closed-World Source Coverage

> Modified BAP provenance artifact. It indexes source identifiers from Carbon
> tag `v11.115.0` at `7518c84ffd00f22434fe19d83119692c12fccb2f` and Carbon
> website commit `df723531e56036f90bac8b1bbec7a0414a285063`. The installed
> Carbon Charts package source uses tag `v1.27.18` at
> `abd30134f12462c9215a823543fdda56779719e6`. No upstream prose, images, or
> implementation source are reproduced.

## Coverage totals

| Source class                         | Required records | Detailed artifact                          |
| ------------------------------------ | ---------------: | ------------------------------------------ |
| React story files                    |              147 | [React stories](coverage-react-stories.md) |
| AST-derived named story declarations |              547 | [React stories](coverage-react-stories.md) |
| React-package MDX files              |              198 | [React MDX](coverage-react-mdx.md)         |
| Carbon website MDX files             |              317 | [Website MDX](coverage-website.md)         |

## Record schema

Every record contains:

- a stable source-class identifier;
- the exact source-relative path and, for stories, exact exported name;
- one status: `included`, `summarized`, `superseded`, or `excluded`;
- a unique local HTML anchor;
- a local knowledge target;
- a nonempty reason.

Story-file and named-story identifiers are separate. A story export is not
considered covered merely because its file is listed.

## Status meanings

| Status       | Meaning                                                                                                                                       |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `included`   | Governing behavior or guidance is represented directly in the local workbench or handbook.                                                    |
| `summarized` | The source adds supporting detail that is consolidated into original local guidance.                                                          |
| `superseded` | A newer canonical name, API, or chapter replaces this source while retaining a migration record.                                              |
| `excluded`   | The source is outside the installed Carbon Core boundary, internal-only, obsolete, or unsuitable for redistribution; the record explains why. |

## Machine verification

The tracked verifier parses every `<a id="...">` element and record block. The
source refresh verifier independently enumerates clean pinned checkouts and
AST-parses named exports. Together they fail when:

- the actual source enumeration differs from 147, 547, 198, or 317;
- an expected identifier is missing or appears more than once;
- an anchor is missing or duplicated across the three detailed artifacts;
- status is outside the allowed set;
- reason or knowledge target is empty;
- a relative knowledge link or fragment does not exist;
- a source pin, Charts package version, source path, status, target, or reviewed
  reason differs from the tracked manifest.

The detailed artifacts use sequential, unique record identifiers and anchors.
Their rows are reviewed classification inputs, not automatically classified
output. Any renumbering remains part of the reviewed change.

## Required topic assertions

In addition to record parity, verification must assert that the website mapping
contains:

- all component usage, style, code, and accessibility pages;
- all element and foundation groups;
- all data-visualization groups;
- designing and developing workflows;
- the Carbon for AI page;
- the component checklist;
- every one of the 18 `src/pages/patterns/**/*.mdx` files.

## Refresh workflow

Follow
[Contribution and upgrades](11-contribution-upgrades.md#closed-world-source-refresh).
Source enumeration and AST parsing must run against clean pinned checkouts. The
source refresh command compares exact input sets with the reviewed tables. New
or removed source identifiers fail until a maintainer deliberately updates the
corresponding table with a status, reason, and target. `--update` recalculates
the deterministic digest manifest only after that complete review. `--check`
remains read-only and byte-compares the manifest. Neither mode fetches sources
or automatically classifies new upstream content in ordinary CI.

Carbon Charts coverage is narrower: installed declarations plus 26 chart and 14
diagram runtime stories are the closed-world API input. The pinned Charts
checkout verifies the exact installed package source and version. Website
data-visualization MDX is mapped guidance, not a claimed complete Charts
documentation or examples inventory.

## Derivative and exclusion notice

These mappings are modified BAP metadata. Paths and exported identifiers are
facts used to establish coverage. The handbook summarizes governing ideas in new
prose. Carbon for IBM Products, Carbon Labs, IBM-only assets, Carbon AI Chat,
and source-only experiments stay visibly excluded unless separately installed
and approved.
