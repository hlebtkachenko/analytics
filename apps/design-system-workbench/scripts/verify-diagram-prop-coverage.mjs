import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { installedEdgeVariants } from './carbon-chart-evidence.mjs';

const root = resolve(import.meta.dirname, '..');
const coverage = JSON.parse(
  await readFile(
    resolve(root, 'src/charts/diagram-prop-coverage.json'),
    'utf8',
  ),
);
const catalog = JSON.parse(
  await readFile(
    resolve(root, '../../packages/design-system/src/catalog.generated.json'),
    'utf8',
  ),
);
const variants = await readFile(
  resolve(root, 'src/charts/diagram-prop-variants.tsx'),
  'utf8',
);
const failures = [];
const declarations = new Map(
  catalog.inventories.charts.declarations['@carbon/charts-react'].map(
    (declaration) => [declaration.name, declaration],
  ),
);
const expected = new Map();
for (const component of catalog.derived.chartDiagramPrimitives) {
  const declaration = declarations.get(component);
  if (!declaration) {
    failures.push(`${component}: no public diagram declaration in the catalog`);
    continue;
  }
  for (const property of declaration.properties) {
    for (const [index, value] of (property.values ?? []).entries()) {
      const id = `api-${component}-${property.name}-${index}`
        .replaceAll(/[^a-zA-Z0-9-]+/g, '-')
        .toLowerCase();
      expected.set(id, {
        component,
        kind: 'declaration-literal',
        property: property.name,
        value,
      });
    }
  }
}
for (const [index, value] of (await installedEdgeVariants()).entries()) {
  expected.set(`api-edge-variant-${index}`, {
    component: 'Edge',
    kind: 'guidance-variant',
    property: 'variant',
    value,
  });
}
const observed = new Set();

for (const record of coverage) {
  if (observed.has(record.id)) {
    failures.push(`${record.id}: duplicate diagram prop coverage record`);
    continue;
  }
  observed.add(record.id);
  const expectedRecord = expected.get(record.id);
  if (!expectedRecord) {
    failures.push(`${record.id}: unknown diagram prop literal`);
  } else if (
    expectedRecord.component !== record.component ||
    expectedRecord.kind !== record.kind ||
    expectedRecord.property !== record.property ||
    expectedRecord.value !== record.value
  ) {
    failures.push(
      `${record.id}: diagram prop literal differs from its catalog record`,
    );
  }
  if (record.executionStatus !== 'covered') {
    failures.push(`${record.id}: diagram prop literal is not executable`);
  }
  if (!record.reason?.trim()) {
    failures.push(`${record.id}: missing reviewed coverage reason`);
  }
  if (
    record.localTarget !==
    `storybook:charts-diagram-primitives--all-prop-literals#${record.id}`
  ) {
    failures.push(`${record.id}: invalid local Storybook deep link`);
  }
}

for (const id of expected.keys()) {
  if (!observed.has(id)) failures.push(`${id}: missing diagram prop literal`);
}
if (coverage.length !== expected.size) {
  failures.push(
    `Expected ${expected.size} catalog-derived diagram prop literals, found ${coverage.length}.`,
  );
}
if (!variants.includes('useVirtualizer')) {
  failures.push('diagram prop variants must virtualize literal records');
}
if (!variants.includes('window.history.replaceState')) {
  failures.push(
    'diagram prop variants must make selected literals deep-linkable',
  );
}

if (process.argv.includes('--built')) {
  const index = JSON.parse(
    await readFile(resolve(root, 'storybook-static/index.json'), 'utf8'),
  );
  if (!index.entries['charts-diagram-primitives--all-prop-literals']) {
    failures.push('built Storybook index has no diagram prop variants story');
  }
}

if (failures.length) {
  throw new Error(`Diagram prop coverage failed:\n${failures.join('\n')}`);
}
console.log(`Diagram prop coverage verified: ${coverage.length} literals.`);
