import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  lstat,
  readdir,
  readFile,
  realpath,
  writeFile,
} from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import ts from 'typescript';

const execute = promisify(execFile);
const appRoot = resolve(import.meta.dirname, '..');
const workspaceRoot = resolve(appRoot, '../..');
const knowledgeBaseDirectory = resolve(
  workspaceRoot,
  'docs/design-system/knowledge-base',
);
const sourceManifestPath = resolve(
  appRoot,
  'scripts/sources/carbon-documentation-coverage.json',
);
const expectedSources = {
  carbonCharts: {
    commit: 'abd30134f12462c9215a823543fdda56779719e6',
    tag: 'v1.27.18',
  },
  carbonReact: {
    commit: '7518c84ffd00f22434fe19d83119692c12fccb2f',
    tag: 'v11.115.0',
  },
  carbonWebsite: {
    commit: 'df723531e56036f90bac8b1bbec7a0414a285063',
  },
};

function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : (process.argv[index + 1] ?? null);
}

function usage() {
  throw new Error(
    'Usage: node scripts/refresh-documentation-coverage.mjs --carbon-react <carbon-root> --carbon-website <website-root> --carbon-charts <charts-root> (--check | --update)',
  );
}

const carbonReactArgument = option('--carbon-react');
const carbonWebsiteArgument = option('--carbon-website');
const carbonChartsArgument = option('--carbon-charts');
const checkMode = process.argv.includes('--check');
const updateMode = process.argv.includes('--update');
if (
  checkMode === updateMode ||
  !carbonReactArgument ||
  !carbonWebsiteArgument ||
  !carbonChartsArgument
) {
  usage();
}
const carbonReactRoot = resolve(carbonReactArgument);
const carbonWebsiteRoot = resolve(carbonWebsiteArgument);
const carbonChartsRoot = resolve(carbonChartsArgument);

function portablePath(root, file) {
  return relative(root, file).split(sep).join('/');
}

async function filesIn(directory, predicate) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`Pinned source must not contain a symlink: ${path}`);
      }
      if (entry.isDirectory()) return filesIn(path, predicate);
      return predicate(entry.name) ? [path] : [];
    }),
  );
  return files.flat().sort((left, right) => left.localeCompare(right));
}

async function gitCommit(directory) {
  const { stdout } = await execute('git', [
    '-C',
    directory,
    'rev-parse',
    'HEAD',
  ]);
  return stdout.trim();
}

async function gitTopLevel(directory) {
  const { stdout } = await execute('git', [
    '-C',
    directory,
    'rev-parse',
    '--show-toplevel',
  ]);
  return realpath(stdout.trim());
}

async function verifyCheckout(label, directory, requiredPath) {
  const stat = await lstat(directory);
  if (stat.isSymbolicLink()) {
    throw new Error(`${label}: checkout root must not be a symlink`);
  }
  const canonicalRoot = await realpath(directory);
  if (canonicalRoot !== directory) {
    throw new Error(
      `${label}: checkout root resolves outside its supplied path`,
    );
  }
  const required = resolve(directory, requiredPath);
  if (!required.startsWith(`${directory}${sep}`)) {
    throw new Error(`${label}: required source path escapes checkout root`);
  }
  const requiredStat = await lstat(required);
  if (!requiredStat.isDirectory() || requiredStat.isSymbolicLink()) {
    throw new Error(`${label}: required source path must be a real directory`);
  }
  const { stdout } = await execute('git', [
    '-C',
    directory,
    'status',
    '--porcelain',
  ]);
  if (stdout.trim()) {
    throw new Error(`${label}: checkout must be clean with no untracked files`);
  }
}

function exportedStoryNames(path, source) {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const names = new Set();
  const isExported = (node) =>
    node.modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    );
  for (const statement of file.statements) {
    if (ts.isVariableStatement(statement) && isExported(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) names.add(declaration.name.text);
      }
    }
    if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement)) &&
      isExported(statement) &&
      statement.name
    ) {
      names.add(statement.name.text);
    }
    if (ts.isExportDeclaration(statement) && statement.exportClause) {
      if (ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) {
          names.add(element.name.text);
        }
      }
    }
  }
  return [...names].sort((left, right) => left.localeCompare(right));
}

function tableRecords(source, prefix, label) {
  return source
    .split('\n')
    .filter((line) => line.includes(`<a id="${prefix}`))
    .map((line) => {
      const cells = line
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.trim());
      const match = cells[0]?.match(/<a id="([^"]+)"><\/a>`([^`]+)`/);
      if (!match || cells.length !== 6) {
        throw new Error(`${label}: malformed provenance record`);
      }
      return {
        anchor: match[1],
        knowledgeTarget: cells[4],
        localTarget: cells[3].replaceAll('`', ''),
        reason: cells[5],
        recordId: match[2],
        source: cells[1].replaceAll('`', ''),
        status: cells[2].replaceAll('`', ''),
      };
    });
}

function digest(values) {
  return createHash('sha256')
    .update([...values].sort().join('\n'))
    .digest('hex');
}

function recordDigest(records) {
  return digest(
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
}

function compareSets(label, expected, actual, failures) {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  if (expectedSet.size !== expected.length) {
    failures.push(`${label}: local coverage contains duplicate source IDs`);
  }
  if (actualSet.size !== actual.length) {
    failures.push(
      `${label}: pinned source enumeration contains duplicate paths`,
    );
  }
  if (
    expected.length !== actual.length ||
    [...expectedSet].some((value) => !actualSet.has(value)) ||
    [...actualSet].some((value) => !expectedSet.has(value))
  ) {
    failures.push(`${label}: pinned source and local coverage sets differ`);
  }
}

await Promise.all([
  verifyCheckout('carbonReact', carbonReactRoot, 'packages/react'),
  verifyCheckout('carbonWebsite', carbonWebsiteRoot, 'src/pages'),
  verifyCheckout('carbonCharts', carbonChartsRoot, 'packages/react'),
]);
const [
  reactCommit,
  websiteCommit,
  chartsCommit,
  reactTopLevel,
  websiteTopLevel,
  chartsTopLevel,
] = await Promise.all([
  gitCommit(carbonReactRoot),
  gitCommit(carbonWebsiteRoot),
  gitCommit(carbonChartsRoot),
  gitTopLevel(carbonReactRoot),
  gitTopLevel(carbonWebsiteRoot),
  gitTopLevel(carbonChartsRoot),
]);
const failures = [];
for (const [label, root, topLevel] of [
  ['carbonReact', carbonReactRoot, reactTopLevel],
  ['carbonWebsite', carbonWebsiteRoot, websiteTopLevel],
  ['carbonCharts', carbonChartsRoot, chartsTopLevel],
]) {
  if (root !== topLevel) {
    failures.push(`${label}: supplied path must be the checkout git root`);
  }
}
for (const [source, expected] of Object.entries(expectedSources)) {
  const actual =
    source === 'carbonReact'
      ? reactCommit
      : source === 'carbonWebsite'
        ? websiteCommit
        : chartsCommit;
  if (actual !== expected.commit)
    failures.push(`${source}: expected pinned commit ${expected.commit}`);
}
const chartsPackage = JSON.parse(
  await readFile(
    resolve(carbonChartsRoot, 'packages/react/package.json'),
    'utf8',
  ),
);
if (chartsPackage.version !== '1.27.18') {
  failures.push('carbonCharts: expected packages/react version 1.27.18');
}

const reactMdx = (
  await filesIn(resolve(carbonReactRoot, 'packages/react'), (name) =>
    name.endsWith('.mdx'),
  )
).map((path) => portablePath(carbonReactRoot, path));
const websiteMdx = (
  await filesIn(resolve(carbonWebsiteRoot, 'src/pages'), (name) =>
    name.endsWith('.mdx'),
  )
).map((path) => portablePath(carbonWebsiteRoot, path));
const storyFiles = (
  await filesIn(resolve(carbonReactRoot, 'packages/react'), (name) =>
    /\.stories\.[cm]?[jt]sx?$/.test(name),
  )
).map((path) => portablePath(carbonReactRoot, path));
const namedStories = (
  await Promise.all(
    storyFiles.map(async (path) => {
      const source = await readFile(resolve(carbonReactRoot, path), 'utf8');
      return exportedStoryNames(path, source).map((name) => `${path}#${name}`);
    }),
  )
)
  .flat()
  .sort((left, right) => left.localeCompare(right));
const [reactMdxCoverage, websiteCoverage, storyCoverage] = await Promise.all([
  readFile(resolve(knowledgeBaseDirectory, 'coverage-react-mdx.md'), 'utf8'),
  readFile(resolve(knowledgeBaseDirectory, 'coverage-website.md'), 'utf8'),
  readFile(
    resolve(knowledgeBaseDirectory, 'coverage-react-stories.md'),
    'utf8',
  ),
]);
const expectedRecords = {
  reactMdx: tableRecords(reactMdxCoverage, 'rm-', 'coverage-react-mdx.md'),
  reactStoryFiles: tableRecords(
    storyCoverage,
    'rs-f',
    'coverage-react-stories.md',
  ),
  reactStoryNames: tableRecords(
    storyCoverage,
    'rs-n',
    'coverage-react-stories.md',
  ),
  websiteMdx: tableRecords(websiteCoverage, 'wm-', 'coverage-website.md'),
};
const discoveredRecords = {
  reactMdx,
  reactStoryFiles: storyFiles,
  reactStoryNames: namedStories,
  websiteMdx,
};
const recordFormats = {
  reactMdx: { anchorPrefix: 'rm-', recordPrefix: 'RM-' },
  reactStoryFiles: { anchorPrefix: 'rs-f', recordPrefix: 'RS-F' },
  reactStoryNames: { anchorPrefix: 'rs-n', recordPrefix: 'RS-N' },
  websiteMdx: { anchorPrefix: 'wm-', recordPrefix: 'WM-' },
};
const allowedStatuses = new Set([
  'excluded',
  'included',
  'summarized',
  'superseded',
]);
const allAnchors = new Set();
const generatedRecords = {};
for (const [key, actual] of Object.entries(discoveredRecords)) {
  const expected = expectedRecords[key];
  const format = recordFormats[key];
  compareSets(
    key,
    expected.map((record) => record.source),
    actual,
    failures,
  );
  for (const [index, record] of expected.entries()) {
    const suffix = String(index + 1).padStart(3, '0');
    const expectedRecordId = `${format.recordPrefix}${suffix}`;
    const expectedAnchor = `${format.anchorPrefix}${suffix}`;
    if (record.recordId !== expectedRecordId) {
      failures.push(`${key}: expected record identifier ${expectedRecordId}`);
    }
    if (record.anchor !== expectedAnchor) {
      failures.push(`${key}: expected record anchor ${expectedAnchor}`);
    }
    if (record.localTarget !== `#${record.anchor}`) {
      failures.push(`${key}: ${record.recordId} has a mismatched local target`);
    }
    if (allAnchors.has(record.anchor)) {
      failures.push(`${key}: duplicate global anchor ${record.anchor}`);
    }
    allAnchors.add(record.anchor);
    if (!allowedStatuses.has(record.status)) {
      failures.push(`${key}: ${record.recordId} has an unknown status`);
    }
    if (!record.reason.trim()) {
      failures.push(`${key}: ${record.recordId} needs a reviewed reason`);
    }
    if (!/^\[guide\]\([^)]+\)$/.test(record.knowledgeTarget)) {
      failures.push(`${key}: ${record.recordId} needs one local guide target`);
    }
  }
  generatedRecords[key] = {
    count: actual.length,
    recordDigest: recordDigest(expected),
    sourcePathDigest: digest(actual),
  };
}

const generatedManifest = `${JSON.stringify(
  {
    schemaVersion: 1,
    pinnedSources: expectedSources,
    records: generatedRecords,
  },
  null,
  2,
)}\n`;

const currentManifest = await readFile(sourceManifestPath, 'utf8');
if (checkMode) {
  if (currentManifest !== generatedManifest) {
    failures.push(
      'tracked source manifest differs; review classifications and run --update',
    );
  }
}

if (failures.length) {
  throw new Error(
    `Pinned documentation coverage refresh failed:\n${failures.join('\n')}`,
  );
}

if (updateMode && currentManifest !== generatedManifest) {
  await writeFile(sourceManifestPath, generatedManifest);
}

console.log(
  `${checkMode ? 'Verified' : 'Updated'} pinned source coverage: ${reactMdx.length} React MDX, ${websiteMdx.length} website MDX, ${storyFiles.length} story files, ${namedStories.length} named stories.`,
);
