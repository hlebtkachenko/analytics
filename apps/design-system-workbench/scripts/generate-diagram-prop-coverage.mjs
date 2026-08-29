import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { installedEdgeVariants } from './carbon-chart-evidence.mjs';

const root = resolve(import.meta.dirname, '..');
const diagrams = resolve(
  root,
  '../../packages/design-system/node_modules/@carbon/charts-react/dist/diagrams',
);
const output = resolve(root, 'src/charts/diagram-prop-coverage.json');
const catalog = JSON.parse(
  await readFile(
    resolve(root, '../../packages/design-system/src/catalog.generated.json'),
    'utf8',
  ),
);
const existing = await readFile(output, 'utf8').catch(() => null);
const sources = Object.fromEntries(
  await Promise.all(
    ['Edge', 'ShapeNode', 'CardNode', 'CardNodeColumn', 'Marker'].map(
      async (name) => [
        name,
        await readFile(resolve(diagrams, `${name}.d.ts`), 'utf8'),
      ],
    ),
  ),
);
const declarations = new Map(
  catalog.inventories.charts.declarations['@carbon/charts-react'].map(
    (declaration) => [declaration.name, declaration],
  ),
);
const fixtures = new Map([
  [
    'ShapeNode',
    'Pinned ShapeNode literal rendered with its required icon and neutral text.',
  ],
  [
    'CardNode',
    'Pinned CardNode literal rendered with neutral contents and any required host props.',
  ],
  [
    'CardNodeColumn',
    'Pinned CardNodeColumn literal rendered inside a neutral CardNode.',
  ],
  ['Marker', 'Pinned marker literal rendered in a neutral SVG fixture.'],
  [
    'ArrowLeftMarker',
    'Pinned marker alias literal rendered in a neutral SVG fixture.',
  ],
  [
    'ArrowRightMarker',
    'Pinned marker alias literal rendered in a neutral SVG fixture.',
  ],
  [
    'CircleMarker',
    'Pinned marker alias literal rendered in a neutral SVG fixture.',
  ],
  [
    'DiamondMarker',
    'Pinned marker alias literal rendered in a neutral SVG fixture.',
  ],
  [
    'SquareMarker',
    'Pinned marker alias literal rendered in a neutral SVG fixture.',
  ],
  [
    'TeeMarker',
    'Pinned marker alias literal rendered in a neutral SVG fixture.',
  ],
]);
const records = [];
function add(component, property, values, kind, reason) {
  values.forEach((value, index) => {
    const id = `api-${component}-${property}-${index}`
      .replaceAll(/[^a-zA-Z0-9-]+/g, '-')
      .toLowerCase();
    records.push({
      args: { [property]: value },
      component,
      executionStatus: 'covered',
      id,
      kind,
      localTarget: `storybook:charts-diagram-primitives--all-prop-literals#${id}`,
      property,
      reason,
      value,
    });
  });
}

for (const component of catalog.derived.chartDiagramPrimitives) {
  const declaration = declarations.get(component);
  if (!declaration) {
    throw new Error(`Missing public diagram declaration for ${component}.`);
  }
  const reason = fixtures.get(component);
  for (const property of declaration.properties) {
    if (!property.values?.length) continue;
    if (!reason) {
      throw new Error(
        `Missing neutral diagram fixture for ${component}.${property.name}.`,
      );
    }
    add(
      component,
      property.name,
      property.values,
      'declaration-literal',
      reason,
    );
  }
}

if (!sources.Edge?.includes('variant?: string')) {
  throw new Error('Edge no longer declares a public variant string.');
}
add(
  'Edge',
  'variant',
  await installedEdgeVariants(),
  'guidance-variant',
  'Pinned Carbon Charts 1.27.18 documented Edge variant rendered in an SVG fixture.',
);

const content = `${JSON.stringify(records, null, 2)}\n`;
if (process.argv.includes('--check')) {
  if (existing !== content)
    throw new Error(
      'Diagram prop coverage is out of date. Run diagram:coverage.',
    );
} else if (existing !== content) {
  await writeFile(output, content);
}
console.log(`Diagram prop coverage verified: ${records.length} literals.`);
