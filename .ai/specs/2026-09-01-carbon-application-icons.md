# Carbon application icons

**Date:** 2026-09-01

## Problem

BAP exposes the entire installed Carbon React icon package through its product
facade, but Carbon application pages use only one icon. The unrestricted barrel
makes icon adoption inconsistent and allows product code to depend on any of
thousands of upstream names without a reviewed semantic choice.

## Scope

Replace the full icon barrel with a small named set used by existing Carbon
pages. Add icons only to actions where the glyph reinforces the visible label:
identity submissions, access capabilities, invitation acceptance, dataset
opening, upload, pagination, export, chat submission, close, and the external
Carbon reference. Preserve visible labels and existing behavior. Keep the five
Phase 10 throwaway organization pages and the temporary account screen exactly
plain, with no icon or design-system adoption. This work adds no icon-only
controls, animation, product workflow, route, custom SVG, pictogram, or custom
icon styling.

## Design

`@bap/design-system/icons` explicitly re-exports only the reviewed icon names
from `@carbon/icons-react`. Applications import those names only through the BAP
entrypoint and pass them to Carbon's supported `renderIcon` prop. Button icons
use Carbon's standard 16px control artboard, inherit the component's
monochrome/current text color, remain center-aligned with their label, and are
decorative in the accessibility tree because the visible text already names the
control. Icon-bearing controls use Carbon's large button size where the previous
small size did not provide a 44px mobile target. Carbon Grid and Column make the
access actions responsive, and a logical minimum-size reset lets Carbon's own
data-table scroller contain wide table content on mobile.

The workbench continues to record the complete installed upstream icon inventory
in generated catalog metadata, but its executable icon explorer shows the
curated BAP facade and states that boundary honestly. Documentation records the
semantic selection and the rule that apps must not import Carbon icons directly
or expand the facade without a real use.

## Security

Icons carry no data and cross no trust boundary. No user, organization, dataset,
authentication, or credential value enters an icon prop. The change must not
alter form payloads, request paths, authorization, logging, redirects, or the
intentionally plain Phase 10 surfaces.

## Verification

Design-system unit tests pin the exact curated exports and the glyphs' intrinsic
behavior at the supported 16, 20, 24, and 32px artboards. A TypeScript compiler
AST contract parses the actual production TSX, pins the exact 21 reviewed
`renderIcon={Identifier}` callsites and their facade imports and visible
children, rejects icon-only replacements and direct upstream imports, and
protects the Phase 10 throwaway marker and zero CSS/design-system/icon boundary.
A committed operational Playwright spec checks the real public and authenticated
controls through a production stack for label-derived accessible names, Carbon
SVG semantics and alignment, 44px targets, keyboard operation, axe, console and
page errors, Phase 10 exclusion, and 640 CSS-pixel layout-equivalent reflow with
no document overflow. This automated reflow check is not browser zoom. A
separate dated local Chrome check must set and read a true 2x tab zoom through
`chrome.tabs.setZoom(2)`; that manual/local evidence is not a CI claim. Run the
design-system catalog check, design-system and workbench unit/browser/offline
gates, web tests, lint, typecheck, builds, exact `pnpm check`, Prettier, stale
contract scans, and `git diff --check`.

## Open questions

None.
