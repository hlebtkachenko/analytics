import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const catalog = JSON.parse(
  await readFile(
    resolve(root, '../../packages/design-system/src/catalog.generated.json'),
    'utf8',
  ),
);
const coverage = JSON.parse(
  await readFile(
    resolve(root, 'src/charts/chart-option-coverage.json'),
    'utf8',
  ),
);
const entries = catalog.inventories.charts.declarations['@carbon/charts'];
const expected = new Map();
const failures = [];

for (const declaration of entries) {
  if (
    !declaration.typeOnly ||
    !declaration.name.endsWith('Options') ||
    !Array.isArray(declaration.properties)
  ) {
    continue;
  }
  for (const property of declaration.properties) {
    for (const [index, value] of (property.values ?? []).entries()) {
      const id = `api-${declaration.name}-${property.name}-${index}`
        .replaceAll(/[^a-zA-Z0-9-]+/g, '-')
        .toLowerCase();
      expected.set(id, {
        declaration: declaration.name,
        property: property.name,
        value,
      });
    }
  }
}

const observed = new Set();
for (const record of coverage) {
  if (observed.has(record.id)) {
    failures.push(`${record.id}: duplicate chart option coverage record`);
    continue;
  }
  observed.add(record.id);
  const expectedRecord = expected.get(record.id);
  if (!expectedRecord) {
    failures.push(`${record.id}: unknown chart option coverage record`);
    continue;
  }
  if (
    expectedRecord.declaration !== record.declaration ||
    expectedRecord.property !== record.property ||
    expectedRecord.value !== record.value
  ) {
    failures.push(
      `${record.id}: literal does not match the pinned declaration`,
    );
  }
  if (
    record.aliasOf !==
    (entries.find((entry) => entry.name === record.declaration)?.aliasOf ??
      null)
  ) {
    failures.push(
      `${record.id}: alias metadata does not match the pinned declaration`,
    );
  }
  if (!record.reason?.trim()) {
    failures.push(`${record.id}: missing reviewed coverage reason`);
  }
  if (record.executionStatus === 'excluded') {
    if (
      record.chart !== null ||
      record.path !== null ||
      record.localTarget !== null
    ) {
      failures.push(`${record.id}: excluded literal has an executable target`);
    }
    continue;
  }
  if (record.executionStatus !== 'covered') {
    failures.push(`${record.id}: invalid execution status`);
    continue;
  }
  if (!record.chart || !Array.isArray(record.path) || !record.path.length) {
    failures.push(`${record.id}: covered literal has no chart patch path`);
  }
  if (
    record.localTarget !==
    `storybook:charts-standard-charts--all-options#${record.id}`
  ) {
    failures.push(`${record.id}: covered literal has no executable deep link`);
  }
}
for (const id of expected.keys()) {
  if (!observed.has(id)) failures.push(`${id}: missing chart option coverage`);
}

const variants = await readFile(
  resolve(root, 'src/charts/chart-option-variants.tsx'),
  'utf8',
);
if (!variants.includes('useVirtualizer')) {
  failures.push('chart option variants must virtualize literal records');
}
if (!variants.includes('chartOptionPatch')) {
  failures.push('chart option variants must apply one nested option patch');
}
if (!variants.includes('window.history.replaceState')) {
  failures.push(
    'chart option variants must make selected literals deep-linkable',
  );
}
if (expected.size !== 292) {
  failures.push(
    `Expected 292 pinned public chart option literals, found ${expected.size}.`,
  );
}

if (process.argv.includes('--built')) {
  const index = JSON.parse(
    await readFile(resolve(root, 'storybook-static/index.json'), 'utf8'),
  );
  if (!index.entries['charts-standard-charts--all-options']) {
    failures.push('built Storybook index has no chart option variants story');
  }
}

if (failures.length) {
  throw new Error(`Chart option coverage failed:\n${failures.join('\n')}`);
}
console.log(
  `Chart option coverage verified: ${coverage.length} literals, ${coverage.filter((record) => record.executionStatus === 'covered').length} executable.`,
);
