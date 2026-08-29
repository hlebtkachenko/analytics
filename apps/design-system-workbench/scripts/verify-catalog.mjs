import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const required = [
  'src/charts/charts.stories.tsx',
  'src/charts/diagrams.stories.tsx',
  'src/explorers/icons.stories.tsx',
  'src/explorers/pictograms.stories.tsx',
  'src/foundations/foundations.stories.tsx',
  'src/foundations/flags.stories.tsx',
];

const missing = [];
for (const file of required) {
  const source = await readFile(resolve(root, file), 'utf8');
  if (!source.includes('export const '))
    missing.push(`${file}: no discoverable stories`);
}

const catalog = await readFile(resolve(root, 'src/shared/catalog.ts'), 'utf8');
for (const symbol of [
  'carbonComponentFamilies',
  'carbonFeatureFlagProviderProps',
  'carbonFeatureFlags',
  'carbonThemes',
]) {
  if (!catalog.includes(symbol))
    missing.push(`src/shared/catalog.ts: missing ${symbol}`);
}
if (
  catalog.includes('@bap/design-system/catalog') ||
  catalog.includes('carbonCatalog')
) {
  missing.push(
    'src/shared/catalog.ts: must not statically import the full catalog',
  );
}

const preview = await readFile(resolve(root, '.storybook/preview.tsx'), 'utf8');
if (
  preview.includes('@bap/design-system/catalog') ||
  preview.includes('carbonCatalog')
) {
  missing.push(
    '.storybook/preview.tsx: must not statically import the full catalog',
  );
}

const foundationExplorer = await readFile(
  resolve(root, 'src/foundations/foundation-explorer.tsx'),
  'utf8',
);
for (const category of [
  'themes',
  'theme-values',
  'react-api',
  'react-cjs',
  'react-esm',
  'colors',
  'type',
  'spacing',
  'layout',
  'grid',
  'layers',
  'motion',
  'fonts',
  'sass-variables',
  'aliases',
  'mixins',
  'functions',
  'charts-api',
]) {
  if (!foundationExplorer.includes(`'${category}'`)) {
    missing.push(`foundation explorer: missing ${category}`);
  }
}
if (!foundationExplorer.includes('useVirtualizer')) {
  missing.push('foundation explorer: token inventories must be virtualized');
}
if (
  !foundationExplorer.includes('<Search') ||
  !foundationExplorer.includes('items.length')
) {
  missing.push(
    'foundation explorer: inventories must be searchable and counted',
  );
}
for (const explorer of [
  'reactApiItems',
  'reactRuntimeItems',
  'chartsApiItems',
]) {
  if (!foundationExplorer.includes(explorer)) {
    missing.push(`foundation explorer: missing ${explorer}`);
  }
}

const flags = await readFile(
  resolve(root, 'src/foundations/flags.stories.tsx'),
  'utf8',
);
for (const symbol of [
  'carbonFeatureFlags',
  'carbonFeatureFlagProviderProps',
  'Release default',
]) {
  if (!flags.includes(symbol)) missing.push(`feature flags: missing ${symbol}`);
}

const handbookDirectory = resolve(
  root,
  '../../docs/design-system/knowledge-base',
);
const handbookIndex = await readFile(
  resolve(handbookDirectory, 'README.md'),
  'utf8',
);
const handbookLinks = [
  ...handbookIndex.matchAll(/^\d+\. \[.+\]\((\d{2}-.+\.md)\)$/gm),
].map((match) => match[1]);
const handbookFiles = (await readdir(handbookDirectory)).filter((file) =>
  /^\d{2}-.+\.md$/.test(file),
);
if (
  handbookLinks.length !== handbookFiles.length ||
  !handbookLinks.every((file) => handbookFiles.includes(file))
) {
  missing.push('offline handbook index and numbered chapter files differ');
}
const knowledgeLoader = await readFile(
  resolve(root, 'src/foundations/knowledge-documents.ts'),
  'utf8',
);
if (
  !knowledgeLoader.includes('import.meta.glob') ||
  !knowledgeLoader.includes('loadKnowledgeDocuments')
) {
  missing.push(
    'knowledge loader must lazily load the build-time handbook glob',
  );
}
if (knowledgeLoader.includes('eager: true')) {
  missing.push(
    'knowledge loader must not bundle every handbook document eagerly',
  );
}
const knowledgeReader = await readFile(
  resolve(root, 'src/foundations/knowledge-search.tsx'),
  'utf8',
);
if (
  knowledgeReader.includes('<pre>') ||
  !knowledgeReader.includes('<LocalMarkdown')
) {
  missing.push(
    'knowledge reader must render Markdown rather than raw preformatted text',
  );
}

const knowledgeDirectory = resolve(root, 'src/knowledge');
const knowledgeProxies = await readdir(knowledgeDirectory);
const handbookSources = (await readdir(handbookDirectory)).filter((file) =>
  file.endsWith('.md'),
);
for (const source of handbookSources) {
  const proxy =
    source === 'README.md' ? 'readme.mdx' : source.replace(/\.md$/, '.mdx');
  if (!knowledgeProxies.includes(proxy))
    missing.push(`knowledge docs: missing ${proxy}`);
}
for (const proxy of knowledgeProxies.filter((file) => file.endsWith('.mdx'))) {
  const source = await readFile(resolve(knowledgeDirectory, proxy), 'utf8');
  if (
    !source.includes('@storybook/addon-docs/blocks') ||
    !source.includes('?raw')
  ) {
    missing.push(
      `knowledge docs: ${proxy} must proxy local Markdown through Storybook Docs`,
    );
  }
}

const staticAssetsDirectory = resolve(root, 'storybook-static/assets');
const staticAssets = await readdir(staticAssetsDirectory).catch(() => []);
for (const asset of staticAssets.filter((file) =>
  /^iframe-.*\.js$/.test(file),
)) {
  const source = await readFile(resolve(staticAssetsDirectory, asset), 'utf8');
  for (const marker of ['grid-breakpoints', 'ChartOptions']) {
    if (source.includes(marker)) {
      missing.push(
        `${asset}: common Storybook chunk includes full catalog metadata`,
      );
    }
  }
}

if (missing.length)
  throw new Error(
    `Workbench catalog verification failed:\n${missing.join('\n')}`,
  );
console.log('Workbench catalog verification passed.');
