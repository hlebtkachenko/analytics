import { access, readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const generatedDirectory = resolve(root, 'src/components/generated');
const coverage = JSON.parse(
  await readFile(
    resolve(generatedDirectory, 'source-story-coverage.json'),
    'utf8',
  ),
);
const manifest = JSON.parse(
  await readFile(resolve(generatedDirectory, 'manifest.json'), 'utf8'),
);
const literalCoverage = JSON.parse(
  await readFile(
    resolve(generatedDirectory, 'literal-prop-coverage.json'),
    'utf8',
  ),
);
const argTypesByName = JSON.parse(
  await readFile(resolve(generatedDirectory, 'arg-types.json'), 'utf8'),
);
const catalog = JSON.parse(
  await readFile(
    resolve(root, '../../packages/design-system/src/catalog.generated.json'),
    'utf8',
  ),
);
const documentationSourceManifest = JSON.parse(
  await readFile(
    resolve(root, 'scripts/sources/carbon-documentation-coverage.json'),
    'utf8',
  ),
);

function storybookId(title, exportName) {
  const slug = (value) =>
    value
      .replaceAll(/[^a-zA-Z0-9]+/g, '-')
      .replaceAll(/^-|-$/g, '')
      .toLowerCase();
  return `${slug(title)}--${slug(exportName)}`;
}

const failures = [];
const files = new Map();
const indexableIds = new Set();
const titlesByName = new Map();

for (const supportingStory of [
  {
    exportName: 'Typography',
    file: 'src/foundations/foundations.stories.tsx',
    id: 'foundations-overview--typography',
  },
  {
    exportName: 'AllCarbonIcons',
    file: 'src/explorers/icons.stories.tsx',
    id: 'explorers-icons--all-carbon-icons',
  },
  {
    exportName: 'White',
    file: 'src/patterns/carbon-for-ai.stories.tsx',
    id: 'patterns-carbon-for-ai--white',
  },
]) {
  const source = await readFile(resolve(root, supportingStory.file), 'utf8');
  const title = source.match(/title:\s*["']([^"']+)["']/)?.[1];
  if (
    !title ||
    !source.includes(`export const ${supportingStory.exportName}`)
  ) {
    failures.push(`${supportingStory.file}: missing indexed supporting story`);
    continue;
  }
  indexableIds.add(supportingStory.id);
}

for (const entry of manifest) {
  const file = resolve(root, entry.story);
  const source = await readFile(file, 'utf8');
  const title = source.match(/title:\s*["']([^"']+)["']/)?.[1];
  if (!title) failures.push(`${entry.name}: missing canonical CSF title`);
  else titlesByName.set(entry.name, title);
  if (!source.includes('argTypes: {')) {
    failures.push(`${entry.name}: missing generated argTypes`);
  }
  if (!source.includes('parameters: story.meta.parameters ?? {}')) {
    failures.push(`${entry.name}: missing registry parameters`);
  }
  if (!source.includes("'autodocs'")) {
    failures.push(`${entry.name}: missing autodocs tag`);
  }
  for (const storyName of [
    'Default',
    'Playground',
    'Variants',
    'States',
    'Controlled',
    'Responsive',
  ]) {
    if (!source.includes(`export const ${storyName}: Story =`)) {
      failures.push(`${entry.name}: missing ${storyName} story`);
    }
    if (title) indexableIds.add(storybookId(title, storyName));
  }
  files.set(entry.name, file);
}

const declarations = new Map(
  [...catalog.react.declarations, ...catalog.react.namespaceMembers].map(
    (entry) => [entry.qualifiedName ?? entry.name, entry],
  ),
);
const expectedLiterals = new Map();
for (const entry of manifest) {
  const declaration = declarations.get(entry.name);
  const argTypes = argTypesByName[entry.name];
  const properties = declaration?.props?.properties ?? [];
  if (!argTypes || Object.keys(argTypes).length !== properties.length) {
    failures.push(`${entry.name}: argTypes do not cover every public prop`);
  }
  for (const property of properties) {
    const argType = argTypes?.[property.name];
    if (!argType) {
      failures.push(`${entry.name}.${property.name}: missing argType`);
      continue;
    }
    if (argType.table?.type?.summary !== property.type) {
      failures.push(
        `${entry.name}.${property.name}: argType does not retain the declaration type`,
      );
    }
    if (
      JSON.stringify(argType.options ?? null) !==
      JSON.stringify(property.values?.length ? property.values : null)
    ) {
      failures.push(
        `${entry.name}.${property.name}: argType options do not match literal values`,
      );
    }
    for (const [index, value] of (property.values ?? []).entries()) {
      const id = `api-${property.name}-${index}`;
      expectedLiterals.set(
        `${entry.name}:${id}`,
        JSON.stringify({
          args: { [property.name]: value },
          componentName: entry.name,
          id,
          propertyName: property.name,
          value,
        }),
      );
    }
  }
}
const observedLiterals = new Set();
for (const record of literalCoverage) {
  const key = `${record.componentName}:${record.id}`;
  if (observedLiterals.has(key)) {
    failures.push(`${key}: duplicate literal coverage record`);
    continue;
  }
  observedLiterals.add(key);
  const expected = expectedLiterals.get(key);
  if (!expected) {
    failures.push(`${key}: unknown literal coverage record`);
    continue;
  }
  if (
    expected !==
    JSON.stringify({
      args: record.args,
      componentName: record.componentName,
      id: record.id,
      propertyName: record.propertyName,
      value: record.value,
    })
  ) {
    failures.push(`${key}: literal coverage does not match the declaration`);
  }
  if (!record.reason?.trim()) {
    failures.push(`${key}: missing literal coverage reason`);
  }
  if (record.executionStatus === 'excluded') {
    if (record.localTarget !== null) {
      failures.push(`${key}: excluded literal has a local target`);
    }
    continue;
  }
  if (record.executionStatus !== 'covered') {
    failures.push(`${key}: unknown literal execution status`);
    continue;
  }
  const title = titlesByName.get(record.componentName);
  const expectedTarget = title
    ? `storybook:${storybookId(title, 'Variants')}#${record.id}`
    : null;
  if (record.localTarget !== expectedTarget) {
    failures.push(`${key}: literal has no executable Variants target`);
  }
}
for (const key of expectedLiterals.keys()) {
  if (!observedLiterals.has(key)) {
    failures.push(`${key}: missing literal coverage record`);
  }
}

const fileRecords = coverage.filter((record) => record.kind === 'file');
const namedRecords = coverage.filter((record) => record.kind === 'named');
if (
  coverage.length !== 694 ||
  fileRecords.length !== 147 ||
  namedRecords.length !== 547
) {
  failures.push(
    `expected 147 files and 547 named stories, found ${fileRecords.length} files and ${namedRecords.length} named records`,
  );
}

function defaultIdentitySource(sourceId) {
  const sourceName = sourceId.split('#')[1] ?? '';
  return (
    sourceName === 'Default' ||
    sourceName.includes('Skeleton') ||
    /^_AISkeleton/.test(sourceName)
  );
}

for (const record of namedRecords) {
  if (
    record.executionStatus === 'covered' &&
    record.localTarget?.endsWith('--default') &&
    !defaultIdentitySource(record.sourceId)
  ) {
    failures.push(
      `${record.sourceId}: non-identity source story cannot target Default`,
    );
  }
}

for (const record of namedRecords) {
  if (
    record.executionStatus !== 'covered' ||
    record.targetKind !== 'composition'
  ) {
    continue;
  }
  if (!record.fixtureDescriptor?.trim()) {
    failures.push(`${record.sourceId}: composition has no fixture descriptor`);
  }
  if (record.fixtureDescriptor === 'base') {
    failures.push(`${record.sourceId}: composition reuses the base fixture`);
  }
  const expectedFingerprint = `${record.sourceId}::${record.fixtureDescriptor}`;
  if (record.sourceFingerprint !== expectedFingerprint) {
    failures.push(
      `${record.sourceId}: composition has no exact source fingerprint`,
    );
  }
  if (/reviewed props, composition, or context/i.test(record.reason ?? '')) {
    failures.push(`${record.sourceId}: composition has a generic reason`);
  }
}

const publicLayerStories = namedRecords.filter((record) => {
  const sourceName = record.sourceId.split('#')[1] ?? '';
  return !sourceName.startsWith('_') && /withlayers?/i.test(sourceName);
});
for (const record of publicLayerStories) {
  if (record.executionStatus === 'excluded') {
    failures.push(`${record.sourceId}: public Layer composition is excluded`);
  }
}
const reviewedLayerSources = new Set([
  'packages/react/src/components/ContentSwitcher/ContentSwitcher.stories.js#IconOnlyWithLayer',
  'packages/react/src/components/FluidTextArea/FluidTextArea.stories.js#DefaultWithLayers',
  'packages/react/src/components/MultiSelect/MultiSelect.stories.js#WithLayerMultiSelect',
  'packages/react/src/components/Search/Search.stories.js#ExpandableWithLayer',
  'packages/react/src/components/Tile/Tile.stories.js#DefaultWithLayer',
  'packages/react/src/components/Tile/Tile.stories.js#ClickableWithLayer',
  'packages/react/src/components/Tile/Tile.stories.js#RadioWithLayer',
  'packages/react/src/components/Tile/Tile.stories.js#ExpandableWithLayer',
]);
const reviewedLayerStories = publicLayerStories.filter((record) =>
  reviewedLayerSources.has(record.sourceId),
);
if (reviewedLayerStories.length !== reviewedLayerSources.size) {
  failures.push('missing a reviewed executable Layer composition');
}
for (const record of reviewedLayerStories) {
  if (
    record.executionStatus !== 'covered' ||
    !record.localTarget?.includes('#source-')
  ) {
    failures.push(
      `${record.sourceId}: public Layer composition must map to an executable layered specimen`,
    );
  }
}

for (const record of coverage) {
  if (!record.reason?.trim())
    failures.push(`${record.sourceId}: missing source reason`);
  if (record.executionStatus === 'excluded') {
    const categories = new Set(['internal-fixture', 'out-of-installed-scope']);
    if (!categories.has(record.exclusionCategory)) {
      failures.push(`${record.sourceId}: missing reviewed exclusion category`);
    }
    if (!record.executionReason?.trim())
      failures.push(`${record.sourceId}: missing exclusion reason`);
    if (!record.executionReason?.includes(record.sourceId)) {
      failures.push(
        `${record.sourceId}: exclusion reason must name its source`,
      );
    }
    if (!record.reason?.includes(record.sourceId)) {
      failures.push(`${record.sourceId}: record reason must name its source`);
    }
    if (
      /mapped individually|explicit registry treatment|excluded parent source|generic treatment/i.test(
        `${record.reason}\n${record.executionReason}`,
      )
    ) {
      failures.push(`${record.sourceId}: generic exclusion reason`);
    }
    if (record.localTarget !== null)
      failures.push(`${record.sourceId}: excluded record has a local target`);
    continue;
  }
  if (record.executionStatus !== 'covered') {
    failures.push(`${record.sourceId}: unknown execution status`);
    continue;
  }
  if (typeof record.localTarget !== 'string' || !record.localTarget.trim()) {
    failures.push(`${record.sourceId}: covered record has no local target`);
    continue;
  }
  if (record.localTarget.startsWith('storybook:')) {
    const [target, anchor] = record.localTarget
      .slice('storybook:'.length)
      .split('#');
    if (!indexableIds.has(target)) {
      failures.push(
        `${record.sourceId}: unresolved Storybook target ${target}`,
      );
    }
    if (anchor === 'modal') {
      const source = await readFile(
        resolve(root, 'src/patterns/carbon-for-ai.stories.tsx'),
        'utf8',
      );
      if (!source.includes('id="modal"')) {
        failures.push(`${record.sourceId}: missing Carbon for AI modal anchor`);
      }
    }
    continue;
  }
  if (record.localTarget.startsWith('variant:')) {
    if (!record.componentName || !files.has(record.componentName)) {
      failures.push(`${record.sourceId}: unresolved component variant target`);
    }
    if (!record.args || Object.keys(record.args).length === 0) {
      failures.push(
        `${record.sourceId}: variant target has no executable args`,
      );
    }
    continue;
  }
  if (
    record.targetKind === 'feature-flag' &&
    record.localTarget.startsWith('storybook:')
  )
    continue;
  failures.push(
    `${record.sourceId}: unsupported local target ${record.localTarget}`,
  );
}

const requiredSourceMappings = new Map([
  [
    'packages/react/src/components/Button/Button.stories.js#IconButton',
    { hasIconOnly: true },
  ],
  [
    'packages/react/src/components/Card/Card.stories.js#Clickable',
    { clickable: true },
  ],
  [
    'packages/react/src/components/ComboBox/ComboBox.stories.js#AllowCustomValue',
    { allowCustomValue: true },
  ],
  [
    'packages/react/src/components/Link/Link.stories.js#Inline',
    { inline: true },
  ],
  [
    'packages/react/src/components/ProgressBar/ProgressBar.stories.js#Indeterminate',
    { helperText: 'Preparing files' },
  ],
  [
    'packages/react/src/components/Tag/Tag.stories.js#ReadOnly',
    { type: 'red' },
  ],
]);
for (const [sourceId, args] of requiredSourceMappings) {
  const record = coverage.find((candidate) => candidate.sourceId === sourceId);
  if (
    record?.executionStatus !== 'covered' ||
    record.targetKind !== 'variant' ||
    JSON.stringify(record.args) !== JSON.stringify(args)
  ) {
    failures.push(`${sourceId}: missing reviewed executable mapping`);
  }
}

const requiredSourceOwners = new Map([
  ['packages/react/src/components/Grid/FlexGrid.stories.js', 'FlexGrid'],
  ['packages/react/src/components/Grid/Grid.stories.js', 'Grid'],
  [
    'packages/react/src/components/AISkeleton/AISkeletonText.stories.js',
    'AISkeletonText',
  ],
  [
    'packages/react/src/components/FluidTextInput/FluidTextInput.stories.js',
    'FluidTextInput',
  ],
  ['packages/react/src/components/Tabs/Tabs.stories.js', 'Tabs'],
  [
    'packages/react/src/components/Notification/stories/Callout.stories.js',
    'Callout',
  ],
  [
    'packages/react/src/components/Notification/stories/InlineNotification.stories.js',
    'InlineNotification',
  ],
  [
    'packages/react/src/components/Notification/stories/StaticNotification.stories.js',
    'StaticNotification',
  ],
  [
    'packages/react/src/components/Notification/stories/ToastNotification.stories.js',
    'ToastNotification',
  ],
  [
    'packages/react/src/components/FileUploader/FileUploader.featureflag.stories.js',
    'FileUploader',
  ],
  [
    'packages/react/src/components/ChatButton/ChatButton.stories.js',
    'preview__ChatButton',
  ],
  [
    'packages/react/src/components/IconIndicator/IconIndicator.stories.js',
    'preview__IconIndicator',
  ],
  ['packages/react/src/components/Layout/Layout.stories.js', 'preview_Layout'],
  [
    'packages/react/src/components/ShapeIndicator/ShapeIndicator.stories.js',
    'preview__ShapeIndicator',
  ],
  ['packages/react/src/components/Text/Text.stories.js', 'preview_Text'],
]);
for (const [sourcePath, componentName] of requiredSourceOwners) {
  const record = coverage.find(
    (candidate) =>
      candidate.kind === 'file' && candidate.sourceId === sourcePath,
  );
  if (record?.componentName !== componentName) {
    failures.push(`${sourcePath}: expected reviewed owner ${componentName}`);
  }
}

const patternSource = await readFile(
  resolve(root, 'src/patterns/patterns.stories.tsx'),
  'utf8',
);
const patternIds = [
  'overview',
  'common-actions',
  'dialog-pattern',
  'disabled-states',
  'disclosures-pattern',
  'empty-states-pattern',
  'filtering',
  'fluid-styles',
  'forms-pattern',
  'global-header',
  'loading-pattern',
  'login-pattern',
  'notification-pattern',
  'overflow-content',
  'read-only-states-pattern',
  'search-pattern',
  'status-indicator-pattern',
  'text-toolbar-pattern',
];
for (const patternId of patternIds) {
  if (!patternSource.includes(`renderCarbonPattern('${patternId}')`)) {
    failures.push(`pattern ${patternId} has no indexed story`);
  }
}

const knowledgeBaseDirectory = resolve(
  root,
  '../../docs/design-system/knowledge-base',
);

function expectedRecordIds(prefix, count) {
  return Array.from(
    { length: count },
    (_, index) => `${prefix}${String(index + 1).padStart(3, '0')}`,
  );
}

function sha256(values) {
  return createHash('sha256').update(values.sort().join('\n')).digest('hex');
}

function verifyDocumentationSourceManifest(recordsByKey) {
  const catalogPackages = new Map(
    (catalog.provenance?.packages ?? []).map((entry) => [entry.name, entry]),
  );
  const carbonReact = catalogPackages.get('@carbon/react');
  const carbonCharts = catalogPackages.get('@carbon/charts');
  const carbonChartsReact = catalogPackages.get('@carbon/charts-react');
  if (!carbonReact?.gitHead || !carbonReact.version) {
    failures.push('catalog provenance: missing @carbon/react package pin');
  } else {
    const [major, ...release] = carbonReact.version.split('.');
    const expectedTag = `v${Number(major) + 10}.${release.join('.')}`;
    if (
      documentationSourceManifest.pinnedSources?.carbonReact?.commit !==
        carbonReact.gitHead ||
      documentationSourceManifest.pinnedSources?.carbonReact?.tag !==
        expectedTag
    ) {
      failures.push(
        'documentation source manifest: @carbon/react pin differs from the installed catalog',
      );
    }
  }
  if (
    !carbonCharts?.gitHead ||
    !carbonCharts.version ||
    !carbonChartsReact?.gitHead ||
    !carbonChartsReact.version
  ) {
    failures.push('catalog provenance: missing Carbon Charts package pins');
  } else if (
    carbonCharts.gitHead !== carbonChartsReact.gitHead ||
    carbonCharts.version !== carbonChartsReact.version ||
    documentationSourceManifest.pinnedSources?.carbonCharts?.commit !==
      carbonCharts.gitHead ||
    documentationSourceManifest.pinnedSources?.carbonCharts?.tag !==
      `v${carbonCharts.version}`
  ) {
    failures.push(
      'documentation source manifest: Carbon Charts pin differs from the installed catalog',
    );
  }
  if (
    documentationSourceManifest.pinnedSources?.carbonWebsite?.commit !==
    'df723531e56036f90bac8b1bbec7a0414a285063'
  ) {
    failures.push('documentation source manifest: missing carbonWebsite pin');
  }
  for (const [key, records] of Object.entries(recordsByKey)) {
    const expected = documentationSourceManifest.records?.[key];
    if (!expected) {
      failures.push(`documentation source manifest: missing ${key}`);
      continue;
    }
    if (expected.count !== records.length) {
      failures.push(`${key}: source manifest count differs from coverage`);
    }
    if (
      expected.sourcePathDigest !==
      sha256(records.map((record) => record.source))
    ) {
      failures.push(`${key}: source path set differs from pinned manifest`);
    }
    const recordDigest = sha256(
      records.map((record) =>
        [
          record.recordId,
          record.source,
          record.status,
          record.anchor,
          record.localTarget,
          record.knowledgeTarget,
          record.reason,
        ].join('\0'),
      ),
    );
    if (expected.recordDigest !== recordDigest) {
      failures.push(`${key}: coverage record set differs from pinned manifest`);
    }
  }
}

function headingIds(source) {
  const ids = new Set(
    [...source.matchAll(/<a id="([^"]+)"><\/a>/g)].map((match) => match[1]),
  );
  for (const match of source.matchAll(/^#{1,6}\s+(.+)$/gm)) {
    const rawHeading = match[1];
    if (/[<>]/.test(rawHeading)) {
      throw new Error('HTML is not allowed in knowledge-base headings.');
    }
    const heading = rawHeading
      .replace(/[`*_]/g, '')
      .replace(/\s+#+$/, '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-');
    if (heading) ids.add(heading);
  }
  return ids;
}

function tableRecords(source, file) {
  return source
    .split('\n')
    .filter((line) => line.includes('<a id="'))
    .map((line) => {
      const cells = line
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.trim());
      const match = cells[0]?.match(/<a id="([^"]+)"><\/a>`([^`]+)`/);
      if (!match || cells.length !== 6) {
        failures.push(`${file}: malformed provenance record`);
        return null;
      }
      const [anchor, recordId] = match.slice(1);
      return {
        anchor,
        file,
        knowledgeTarget: cells[4],
        localTarget: cells[3].replaceAll('`', ''),
        reason: cells[5],
        recordId,
        source: cells[1].replaceAll('`', ''),
        status: cells[2].replaceAll('`', ''),
      };
    })
    .filter(Boolean);
}

function validateKnowledgeRecords(records, prefix, count) {
  const expected = new Set(expectedRecordIds(prefix, count));
  const allowedStatuses = new Set([
    'included',
    'summarized',
    'superseded',
    'excluded',
  ]);
  if (records.length !== count) {
    failures.push(
      `${prefix}: expected ${count} records, found ${records.length}`,
    );
  }
  for (const record of records) {
    if (!expected.delete(record.recordId)) {
      failures.push(
        `${record.file}: unexpected or duplicate ${record.recordId}`,
      );
    }
    if (record.anchor !== record.recordId.toLowerCase()) {
      failures.push(
        `${record.recordId}: anchor must equal its lowercase record ID`,
      );
    }
    if (record.localTarget !== `#${record.anchor}`) {
      failures.push(
        `${record.recordId}: local target must resolve to its anchor`,
      );
    }
    if (
      !record.source.trim() ||
      !record.status.trim() ||
      !record.reason.trim()
    ) {
      failures.push(
        `${record.recordId}: source, status, and reason are required`,
      );
    }
    if (!allowedStatuses.has(record.status)) {
      failures.push(`${record.recordId}: invalid provenance status`);
    }
    if (!/^\[[^\]]+\]\([^)]+\)$/.test(record.knowledgeTarget)) {
      failures.push(`${record.recordId}: missing local knowledge link`);
    }
  }
  for (const recordId of expected) {
    failures.push(`${prefix}: missing ${recordId}`);
  }
}

function localLinkTarget(cell) {
  return cell.match(/^\[[^\]]+\]\(([^)]+)\)$/)?.[1] ?? null;
}

async function verifyKnowledgeBase() {
  const chapterFiles = Array.from(
    { length: 11 },
    (_, index) => `${String(index + 1).padStart(2, '0')}-`,
  );
  const markdownFiles = (await readdir(knowledgeBaseDirectory))
    .filter((file) => file.endsWith('.md'))
    .sort();
  const documents = new Map(
    await Promise.all(
      markdownFiles.map(async (file) => [
        file,
        await readFile(resolve(knowledgeBaseDirectory, file), 'utf8'),
      ]),
    ),
  );
  const documentHeadings = new Map(
    [...documents].map(([file, source]) => [file, headingIds(source)]),
  );
  const sourceRecords = tableRecords(
    documents.get('coverage-react-stories.md') ?? '',
    'coverage-react-stories.md',
  );
  const provenanceGroups = [
    {
      file: 'coverage-react-mdx.md',
      prefix: 'RM-',
      count: 198,
      key: 'reactMdx',
    },
    {
      file: 'coverage-website.md',
      prefix: 'WM-',
      count: 317,
      key: 'websiteMdx',
    },
    {
      file: 'coverage-react-stories.md',
      prefix: 'RS-F',
      count: 147,
      key: 'reactStoryFiles',
    },
    {
      file: 'coverage-react-stories.md',
      prefix: 'RS-N',
      count: 547,
      key: 'reactStoryNames',
    },
  ];
  const recordsByKey = Object.fromEntries(
    provenanceGroups.map((group) => {
      const records =
        group.file === 'coverage-react-stories.md'
          ? sourceRecords.filter((record) =>
              record.recordId.startsWith(group.prefix),
            )
          : tableRecords(documents.get(group.file) ?? '', group.file);
      validateKnowledgeRecords(records, group.prefix, group.count);
      return [group.key, records];
    }),
  );
  verifyDocumentationSourceManifest(recordsByKey);
  const provenanceRecords = Object.values(recordsByKey).flat();
  const uniqueAnchors = new Set();
  for (const record of provenanceRecords) {
    if (uniqueAnchors.has(record.anchor)) {
      failures.push(`knowledge base: duplicate record anchor ${record.anchor}`);
    }
    uniqueAnchors.add(record.anchor);
  }
  if (uniqueAnchors.size !== 1209) {
    failures.push(
      `knowledge base: expected 1209 unique record anchors, found ${uniqueAnchors.size}`,
    );
  }

  const expectedPatternPaths = new Set([
    'src/pages/patterns/common-actions/index.mdx',
    'src/pages/patterns/dialog-pattern/index.mdx',
    'src/pages/patterns/disabled-states/index.mdx',
    'src/pages/patterns/disclosures-pattern/index.mdx',
    'src/pages/patterns/empty-states-pattern/index.mdx',
    'src/pages/patterns/filtering/index.mdx',
    'src/pages/patterns/fluid-styles/index.mdx',
    'src/pages/patterns/forms-pattern/index.mdx',
    'src/pages/patterns/global-header/index.mdx',
    'src/pages/patterns/loading-pattern/index.mdx',
    'src/pages/patterns/login-pattern/index.mdx',
    'src/pages/patterns/notification-pattern/index.mdx',
    'src/pages/patterns/overflow-content/index.mdx',
    'src/pages/patterns/overview.mdx',
    'src/pages/patterns/read-only-states-pattern/index.mdx',
    'src/pages/patterns/search-pattern/index.mdx',
    'src/pages/patterns/status-indicator-pattern/index.mdx',
    'src/pages/patterns/text-toolbar-pattern/index.mdx',
  ]);
  const websiteRecords = provenanceRecords.filter((record) =>
    record.recordId.startsWith('WM-'),
  );
  const actualPatternPaths = new Set(
    websiteRecords
      .map((record) => record.source)
      .filter((source) => source.startsWith('src/pages/patterns/')),
  );
  if (
    actualPatternPaths.size !== expectedPatternPaths.size ||
    [...expectedPatternPaths].some((path) => !actualPatternPaths.has(path))
  ) {
    failures.push(
      'knowledge base: website pattern source paths are incomplete',
    );
  }

  for (const [file, source] of documents) {
    for (const match of source.matchAll(/\[[^\]]+\]\(([^)\s]+)\)/g)) {
      const target = match[1];
      if (/^(?:https?:|mailto:|tel:)/.test(target)) continue;
      const [targetFile, fragment] = target.split('#', 2);
      const resolvedFile = targetFile || file;
      const targetHeadings = documentHeadings.get(resolvedFile);
      if (!targetHeadings) {
        failures.push(`${file}: unresolved local knowledge link ${target}`);
        continue;
      }
      if (fragment && !targetHeadings.has(decodeURIComponent(fragment))) {
        failures.push(`${file}: unresolved local heading ${target}`);
      }
    }
  }
  for (const record of provenanceRecords) {
    const target = localLinkTarget(record.knowledgeTarget);
    if (!target || /^(?:https?:|mailto:|tel:)/.test(target)) {
      failures.push(`${record.recordId}: knowledge target must be local`);
    }
  }
  for (const chapterPrefix of chapterFiles) {
    const file = markdownFiles.find((candidate) =>
      candidate.startsWith(chapterPrefix),
    );
    const source = file ? documents.get(file) : null;
    if (!file || !source) {
      failures.push(`knowledge base: missing chapter ${chapterPrefix}`);
      continue;
    }
    if (!/^> Modified BAP (?:guidance|checklist)\./m.test(source)) {
      failures.push(`${file}: missing Modified BAP attribution`);
    }
    if (
      !/[0-9a-f]{40}/i.test(source) &&
      !/tag `v\d+\.\d+\.\d+`/i.test(source)
    ) {
      failures.push(`${file}: missing pinned upstream source`);
    }
  }
}

await verifyKnowledgeBase();

if (process.argv.includes('--built')) {
  const indexPath = resolve(root, 'storybook-static/index.json');
  try {
    await access(indexPath);
    const index = JSON.parse(await readFile(indexPath, 'utf8'));
    const builtIds = new Set(Object.keys(index.entries ?? {}));
    for (const id of indexableIds) {
      if (!builtIds.has(id)) failures.push(`built index is missing ${id}`);
    }
    for (const [name, title] of titlesByName) {
      const docsId = storybookId(title, 'docs');
      if (!builtIds.has(docsId)) {
        failures.push(
          `${name}: built index is missing autodocs page ${docsId}`,
        );
      }
    }
  } catch {
    failures.push('built Storybook index is unavailable');
  }
}

if (failures.length) {
  throw new Error(
    `Component coverage verification failed:\n${failures.join('\n')}`,
  );
}

console.log(
  `Verified ${manifest.length} components, 147 story files, 547 named stories, and 18 patterns.`,
);
