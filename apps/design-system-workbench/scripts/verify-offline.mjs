/* global document, getComputedStyle */

import { createReadStream } from 'node:fs';
import { access, readdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const appDirectory = resolve(fileURLToPath(import.meta.url), '..', '..');
const workspaceDirectory = resolve(appDirectory, '..', '..');
const outputDirectory = resolve(process.argv[2] ?? 'storybook-static');
const contentTypes = {
  '.css': 'text/css',
  '.gif': 'image/gif',
  '.html': 'text/html',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.mjs': 'text/javascript',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function entryFor(entries, title, name) {
  const entry = entries.find(
    (candidate) => candidate.title === title && candidate.name === name,
  );
  assert(entry, `Missing ${title} / ${name} from index.json.`);
  return entry;
}

function entriesForTitle(entries, title) {
  return entries.filter((entry) => entry.title === title);
}

function entriesForPrefix(entries, prefix) {
  return entries.filter((entry) => entry.title.startsWith(prefix));
}

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(directory, entry.name);
      return entry.isDirectory() ? listFiles(path) : [path];
    }),
  );
  return paths.flat();
}

async function carbonFeatureFlags() {
  const catalogPath = resolve(
    workspaceDirectory,
    'packages/design-system/src/catalog.generated.json',
  );
  const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
  const flags = catalog.featureFlags?.installed;
  const defaults = catalog.featureFlags?.defaults;
  const providerProps = catalog.featureFlags?.providerProps;
  assert(Array.isArray(flags), 'Carbon feature flag inventory is missing.');
  assert(
    defaults && typeof defaults === 'object',
    'Flag defaults are missing.',
  );
  assert(Array.isArray(providerProps), 'Flag provider metadata is missing.');
  assert(
    flags.length === 18,
    `Expected 18 installed flags, found ${flags.length}.`,
  );
  assert(
    new Set(flags.map(({ flag }) => flag)).size === flags.length,
    'Carbon feature flags include duplicates.',
  );
  assert(
    Object.keys(defaults).length === flags.length,
    'Carbon feature flag defaults are incomplete.',
  );
  for (const { defaultValue, flag, providerProp } of flags) {
    assert(typeof flag === 'string', 'A Carbon feature flag has no name.');
    assert(
      typeof defaultValue === 'boolean',
      `Carbon feature flag ${flag} has no boolean default.`,
    );
    assert(
      defaults[flag] === defaultValue,
      `Carbon feature flag ${flag} default does not match its inventory.`,
    );
    assert(
      providerProp === null || typeof providerProp === 'string',
      `Carbon feature flag ${flag} has invalid provider metadata.`,
    );
  }
  assert(
    providerProps.length === 11,
    `Expected 11 runtime provider props, found ${providerProps.length}.`,
  );
  return { defaults, flags, providerProps };
}

async function componentManifest() {
  const manifestPath = resolve(
    appDirectory,
    'src/components/generated/manifest.json',
  );
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  assert(Array.isArray(manifest), 'Component manifest is not an array.');
  assert(manifest.length > 0, 'Component manifest is empty.');
  return manifest;
}

async function validateIndex(index) {
  assert(index && typeof index === 'object', 'index.json is not an object.');
  assert(
    index.entries && typeof index.entries === 'object',
    'index.json has no entries.',
  );
  const entries = Object.values(index.entries).filter(
    (entry) => entry.type === 'story',
  );
  assert(entries.length > 0, 'index.json has no story entries.');

  const components = entriesForPrefix(entries, 'Components/');
  const componentTitles = new Set(components.map((entry) => entry.title));
  const manifest = await componentManifest();
  const componentStoryNames = [
    'Default',
    'Playground',
    'Variants',
    'States',
    'Controlled',
    'Responsive',
  ];
  assert(
    componentTitles.size === manifest.length,
    `Expected ${manifest.length} component titles, found ${componentTitles.size}.`,
  );
  for (const { name } of manifest) {
    const titles = [...componentTitles].filter(
      (title) => title.split('/').at(-1) === name,
    );
    assert(
      titles.length === 1,
      `Component manifest entry ${name} has ${titles.length} matching titles.`,
    );
    const [title] = titles;
    const stories = entriesForTitle(components, title);
    assert(stories.length, `Component ${title} is absent from index.json.`);
    for (const storyName of componentStoryNames) {
      assert(
        stories.some((entry) => entry.name === storyName),
        `Component ${title} has no ${storyName} story.`,
      );
    }
  }

  assert(
    entriesForPrefix(entries, 'Foundations/').length >= 8,
    'Foundations coverage is incomplete.',
  );
  assert(
    entriesForPrefix(entries, 'Patterns/').length >= 18,
    'Carbon pattern coverage is incomplete.',
  );
  assert(
    entriesForPrefix(entries, 'Explorers/').length >= 2,
    'Icon and pictogram explorers are missing.',
  );
  assert(
    entriesForTitle(entries, 'Charts/Standard charts').length >= 27,
    'Standard chart coverage is incomplete.',
  );
  assert(
    entriesForTitle(entries, 'Charts/Diagram primitives').length >= 15,
    'Diagram primitive coverage is incomplete.',
  );

  return entries;
}

function errorDisplayPresent(text) {
  return /error rendering story|failed to render|uncaught error/i.test(text);
}

await access(outputDirectory);
const index = JSON.parse(
  await readFile(resolve(outputDirectory, 'index.json'), 'utf8'),
);
const entries = await validateIndex(index);
const chartOptionCoverage = JSON.parse(
  await readFile(
    resolve(appDirectory, 'src/charts/chart-option-coverage.json'),
    'utf8',
  ),
);
const chartOptionExcludedCount = chartOptionCoverage.filter(
  (record) => record.executionStatus === 'excluded',
).length;
const fontFiles = (await listFiles(outputDirectory)).filter((path) =>
  /\.(ttf|woff2?)$/.test(path),
);
assert(
  fontFiles.length > 0,
  'The static workbench contains no local font assets.',
);

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const pathname = decodeURIComponent(url.pathname);
  const target = resolve(
    outputDirectory,
    pathname === '/' ? 'index.html' : `.${pathname}`,
  );
  const pathFromOutput = relative(outputDirectory, target);
  if (pathFromOutput.startsWith('..') || pathFromOutput.startsWith('/')) {
    response.writeHead(403).end();
    return;
  }
  try {
    await access(target);
    response.writeHead(200, {
      'content-type':
        contentTypes[extname(target)] ?? 'application/octet-stream',
    });
    createReadStream(target).pipe(response);
  } catch {
    response.writeHead(404).end();
  }
});

await new Promise((listen) => server.listen(0, '127.0.0.1', listen));
const address = server.address();
const origin = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
const localUrl = new URL(origin);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  locale: 'en-US',
  viewport: { height: 900, width: 1280 },
});
const failures = [];
const pageErrors = [];
const remoteRequests = new Set();
const consoleErrors = [];

function isLocalUrl(url) {
  return url.hostname === localUrl.hostname && url.port === localUrl.port;
}

page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});
page.on('pageerror', (error) => pageErrors.push(error.message));
page.on('websocket', (socket) => {
  const url = new URL(socket.url());
  if (!isLocalUrl(url)) remoteRequests.add(url.href);
});
await page.routeWebSocket(
  (url) => !isLocalUrl(url),
  async (socket) => {
    remoteRequests.add(socket.url());
    await socket.close({ code: 1008, reason: 'Offline audit' });
  },
);
await page.route('**/*', (route) => {
  const requestUrl = new URL(route.request().url());
  if (
    (requestUrl.protocol === 'http:' || requestUrl.protocol === 'https:') &&
    !isLocalUrl(requestUrl)
  ) {
    remoteRequests.add(requestUrl.href);
    return route.abort();
  }
  return route.continue();
});

function iframeUrl(entry, globals, args) {
  const url = new URL('/iframe.html', origin);
  url.searchParams.set('id', entry.id);
  if (args) url.searchParams.set('args', args);
  if (globals) url.searchParams.set('globals', globals);
  return url.href;
}

async function assertHealthy(label, errorStart, consoleStart) {
  const storyRoot = page.locator('#storybook-root');
  await storyRoot.waitFor({ state: 'attached', timeout: 20_000 });
  await page.waitForFunction(
    () => document.querySelector('#storybook-root')?.childElementCount,
    undefined,
    { timeout: 20_000 },
  );
  await page.waitForTimeout(100);
  const rendered = await storyRoot.evaluate(
    (root) =>
      Boolean(root.textContent?.trim()) ||
      Boolean(root.querySelector('button, input, select, svg, [role]')),
  );
  assert(rendered, `${label} rendered no story content.`);
  const bodyText = await page.locator('body').innerText();
  assert(!errorDisplayPresent(bodyText), `${label} showed Storybook error UI.`);
  const errors = pageErrors.slice(errorStart);
  assert(!errors.length, `${label} raised page errors: ${errors.join('\n')}`);
  const console = consoleErrors.slice(consoleStart);
  assert(
    !console.length,
    `${label} logged console errors: ${console.join('\n')}`,
  );
}

async function visit(entry, label, globals, args) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const pageErrorStart = pageErrors.length;
    const consoleErrorStart = consoleErrors.length;
    try {
      await page.goto(iframeUrl(entry, globals, args), {
        timeout: 20_000,
        waitUntil: 'domcontentloaded',
      });
      await assertHealthy(label, pageErrorStart, consoleErrorStart);
      return;
    } catch (error) {
      if (attempt) throw error;
    }
  }
}

async function assertManagerDocs(label) {
  const frame = page.frameLocator('#storybook-preview-iframe');
  await frame.locator('body').waitFor({ timeout: 20_000 });
  const content = await frame.locator('body').innerText();
  assert(content.trim(), `${label} rendered no Docs content.`);
  assert(!errorDisplayPresent(content), `${label} showed Storybook error UI.`);
}

async function check(label, operation) {
  try {
    await operation();
  } catch (error) {
    failures.push(
      `${label}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

try {
  const overview = entryFor(entries, 'Foundations/Overview', 'Overview');
  const buttonDefault = entryFor(entries, 'Components/Button', 'Default');
  const buttonPlayground = entryFor(entries, 'Components/Button', 'Playground');
  const buttonVariants = entryFor(entries, 'Components/Button', 'Variants');
  const overflowMenu = entryFor(entries, 'Components/OverflowMenu', 'Default');
  const knowledgeBase = entryFor(
    entries,
    'Foundations/Knowledge base',
    'Local Handbook',
  );
  const icons = entryFor(entries, 'Explorers/Icons', 'All Carbon Icons');
  const iconsSize32 = entryFor(entries, 'Explorers/Icons', 'Icon Size 32');
  const pictograms = entryFor(
    entries,
    'Explorers/Pictograms',
    'All Carbon Pictograms',
  );
  const pattern = entryFor(entries, 'Patterns/Carbon Core', 'Overview');
  const carbonForAiWhite = entryFor(entries, 'Patterns/Carbon for AI', 'White');
  const carbonForAiG10 = entryFor(entries, 'Patterns/Carbon for AI', 'G 10');
  const carbonForAiG90 = entryFor(entries, 'Patterns/Carbon for AI', 'G 90');
  const carbonForAiG100 = entryFor(entries, 'Patterns/Carbon for AI', 'G 100');
  const flagDefaults = entryFor(
    entries,
    'Foundations/Feature flags',
    'Release Defaults',
  );
  const chartOptions = entryFor(
    entries,
    'Charts/Standard charts',
    'All Options',
  );
  const diagramOptions = entryFor(
    entries,
    'Charts/Diagram primitives',
    'All Prop Literals',
  );
  const chartEntries = entriesForTitle(entries, 'Charts/Standard charts');
  const diagramEntries = entriesForTitle(entries, 'Charts/Diagram primitives');
  const requiredDiagramStories = [
    'Edge Dash Small',
    'Edge Dash Medium',
    'Edge Dash Large',
    'Edge Dash Extra Large',
    'Edge Double',
    'Edge Tunnel',
    'Shape Circle',
    'Shape Square Button',
    'Shape Rounded Square Link',
    'Card Button',
    'Card Link',
    'Card Stacked',
    'All Prop Literals',
  ];

  await check('Static Storybook manager', async () => {
    const pageErrorStart = pageErrors.length;
    const consoleErrorStart = consoleErrors.length;
    await page.goto(`${origin}/`, {
      timeout: 20_000,
      waitUntil: 'domcontentloaded',
    });
    const search = page.getByPlaceholder('Find components');
    await search.waitFor({ timeout: 20_000 });
    const managerText = await page.locator('body').innerText();
    assert(
      /components/i.test(managerText) && /foundations/i.test(managerText),
      'Static Storybook manager has no category navigation.',
    );
    await search.fill('Button');
    await page.waitForFunction(() =>
      document.body.innerText.includes('Button'),
    );
    await page.goto(`${origin}/?path=/story/${buttonDefault.id}`, {
      timeout: 20_000,
      waitUntil: 'domcontentloaded',
    });
    await page
      .locator('#storybook-preview-iframe')
      .waitFor({ timeout: 10_000 });
    await search.fill('Data visualization');
    await page.waitForFunction(() =>
      document.body.innerText.includes('08 Data visualization'),
    );
    await page.goto(
      `${origin}/?path=/docs/knowledge-base-08-data-visualization--docs`,
      { timeout: 20_000, waitUntil: 'domcontentloaded' },
    );
    await page
      .locator('#storybook-preview-iframe')
      .waitFor({ timeout: 10_000 });
    assert(
      !pageErrors.slice(pageErrorStart).length,
      'Static Storybook manager raised page errors.',
    );
    assert(
      !consoleErrors.slice(consoleErrorStart).length,
      'Static Storybook manager logged console errors.',
    );
  });

  await check('Foundations overview', async () => {
    await visit(overview, 'Foundations overview');
    await page.getByText('Carbon foundation catalog').waitFor();
    const surface = await page.evaluate(async () => {
      await document.fonts.ready;
      const root = document.querySelector('#storybook-root');
      return {
        fontFaces: [...document.fonts].map((font) => font.family),
        fontFamily: root ? getComputedStyle(root).fontFamily : '',
        styles: document.querySelectorAll('link[rel="stylesheet"], style')
          .length,
      };
    });
    assert(surface.styles > 0, 'The workbench applied no local styles.');
    assert(
      /plex/i.test(`${surface.fontFamily} ${surface.fontFaces.join(' ')}`),
      'The workbench did not load a local Plex font.',
    );
  });

  for (const theme of ['white', 'g10', 'g90', 'g100']) {
    await check(`Theme ${theme}`, async () => {
      await visit(overview, `Theme ${theme}`, `theme:${theme}`);
      await page
        .locator(`html[data-carbon-theme="${theme}"]`)
        .waitFor({ timeout: 10_000 });
    });
  }

  for (const direction of ['ltr', 'rtl']) {
    await check(`Layout direction ${direction}`, async () => {
      await visit(
        overview,
        `Layout direction ${direction}`,
        `direction:${direction}`,
      );
      await page
        .locator(`html[dir="${direction}"]`)
        .waitFor({ timeout: 10_000 });
      await page
        .locator(`[data-workbench-direction="${direction}"]`)
        .waitFor({ timeout: 10_000 });
    });
  }
  await check('Layout direction release reset', () =>
    visit(overview, 'Layout direction release reset', 'direction:ltr'),
  );

  const { flags, providerProps } = await carbonFeatureFlags();
  await check('All 18 installed feature flags and defaults', async () => {
    await visit(flagDefaults, 'Feature flag release defaults');
    for (const { defaultValue, flag, providerProp } of flags) {
      const tile = page
        .locator('#storybook-root')
        .getByText(flag, { exact: true })
        .locator('..');
      await tile.waitFor({ timeout: 10_000 });
      const text = await tile.innerText();
      assert(
        text.includes(`Default: ${String(defaultValue)}`),
        `Feature flag ${flag} does not show its installed default.`,
      );
      assert(
        providerProp
          ? text.includes(`Runtime provider prop: ${providerProp}`)
          : text.includes('No React FeatureFlags provider prop'),
        `Feature flag ${flag} has incorrect reset metadata.`,
      );
    }
  });
  for (const { flag } of flags) {
    await check(`Feature flag ${flag} runtime reset`, async () => {
      await visit(overview, `Feature flag ${flag}`, `${flag}:true`);
      await visit(overview, `Feature flag ${flag} disabled`, `${flag}:false`);
      await visit(
        overview,
        `Feature flag ${flag} reset`,
        `${flag}:release-default`,
      );
    });
  }

  await check('Button default', async () => {
    await visit(buttonDefault, 'Button default');
    await page.getByRole('button').first().waitFor();
  });
  await check('Button playground', () =>
    visit(buttonPlayground, 'Button playground'),
  );
  await check('Button variants', () =>
    visit(buttonVariants, 'Button variants'),
  );

  await check('Overflow menu keyboard focus', async () => {
    await visit(overflowMenu, 'Overflow menu');
    const button = page.getByRole('button').first();
    await button.focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(50);
    assert(
      await button.evaluate((element) => document.activeElement === element),
      'The overflow menu button did not retain keyboard focus.',
    );
  });

  await check('Local knowledge search', async () => {
    await visit(knowledgeBase, 'Local knowledge base');
    const search = page.locator('#knowledge-search');
    await search.fill('accessibility');
    const result = page
      .locator('section[aria-label="Knowledge base search"] li a')
      .first();
    await result.waitFor({ timeout: 10_000 });
    assert(
      (await result.getAttribute('href'))?.includes('?path=/docs/') ?? false,
      'Knowledge search did not return a local handbook link.',
    );
  });

  for (const [label, entry, searchLabel, expectedCount] of [
    ['Icon explorer', icons, 'Search Carbon icons', 2762],
    ['Pictogram explorer', pictograms, 'Search Carbon pictograms', 1575],
  ]) {
    await check(label, async () => {
      await visit(entry, label);
      assert(
        (await page
          .locator(
            `#storybook-root section[aria-label="${label === 'Icon explorer' ? 'Carbon icons' : 'Carbon pictograms'}"] p`,
          )
          .innerText()) === `${expectedCount.toLocaleString('en-US')} results`,
        `${label} does not expose its complete installed export count.`,
      );
      const results = page.locator('[role="listitem"]');
      await results.first().waitFor({ timeout: 10_000 });
      const itemName = await results.first().locator('code').innerText();
      await page.getByLabel(searchLabel).fill(itemName);
      await results.first().getByText(itemName, { exact: true }).waitFor();
      assert(
        (await results.count()) < 100,
        `${label} is not rendering a virtualized result window.`,
      );
    });
  }

  await check('Icon explorer size 32', async () => {
    await visit(iconsSize32, 'Icon explorer size 32');
    assert(
      (await page
        .locator('[role="listitem"] svg')
        .first()
        .getAttribute('width')) === '32',
      'Icon explorer did not apply the requested official size.',
    );
  });

  await check('Pattern overview', () => visit(pattern, 'Pattern overview'));

  for (const entry of chartEntries) {
    await check(`Chart ${entry.name}`, async () => {
      await visit(entry, `Chart ${entry.name}`);
      await page.locator('#storybook-root figure').waitFor({ timeout: 10_000 });
      await page.locator('#storybook-root table').waitFor({ timeout: 10_000 });
      const chartSvg = page
        .locator('#storybook-root figure svg:not([aria-hidden="true"])')
        .first();
      await chartSvg.waitFor({ timeout: 10_000 });
      assert(
        !/NaN/.test(await chartSvg.evaluate((svg) => svg.outerHTML)),
        `Chart ${entry.name} rendered invalid SVG coordinates.`,
      );
    });
  }

  await check('Chart option literal selector', async () => {
    await visit(chartOptions, 'Chart option literals');
    await page
      .getByText(`${chartOptionExcludedCount} exclusion records`)
      .waitFor();
    await page
      .getByRole('searchbox', { name: 'Search Carbon chart option literals' })
      .fill('AxisOptions.scaleType');
    const option = page.getByRole('button', {
      exact: true,
      name: 'AxisOptions.scaleType = labels',
    });
    await option.waitFor();
    await option.click();
    await page
      .locator('[data-chart-option-selected="api-axisoptions-scaletype-3"]')
      .waitFor({ timeout: 10_000 });
    assert(
      (await page.url()).endsWith('#api-axisoptions-scaletype-3'),
      'Chart option selection did not update the deep-link fragment.',
    );
    await page
      .locator(
        '[role="listitem"][data-chart-option-id="api-axisoptions-scaletype-3"]',
      )
      .waitFor();
    await page
      .getByRole('searchbox', { name: 'Search Carbon chart option literals' })
      .fill('RulerOptions');
    const rulerExclusions = page.locator(
      '[data-chart-option-excluded^="api-ruleroptions-"]',
    );
    await rulerExclusions.first().waitFor({ timeout: 10_000 });
    const rulerExclusionIds = await rulerExclusions.evaluateAll((elements) =>
      elements.map((element) =>
        element.getAttribute('data-chart-option-excluded'),
      ),
    );
    assert(
      JSON.stringify(rulerExclusionIds) ===
        JSON.stringify([
          'api-ruleroptions-enabled-0',
          'api-ruleroptions-enabled-1',
        ]),
      'RulerOptions exclusion filtering did not return its complete reviewed set.',
    );
  });

  for (const entry of diagramEntries) {
    await check(`Diagram ${entry.name}`, async () => {
      await visit(entry, `Diagram ${entry.name}`);
      await page
        .locator('#storybook-root')
        .getByRole('heading')
        .first()
        .waitFor({ timeout: 10_000 });
    });
  }

  await check('Diagram prop literal selector', async () => {
    await visit(diagramOptions, 'Diagram prop literals');
    await page
      .getByRole('searchbox', { name: 'Search Carbon diagram prop literals' })
      .fill('Edge.variant');
    await page.getByText('Edge.variant = double').click();
    await page
      .locator('[data-diagram-prop-selected="api-edge-variant-4"]')
      .waitFor({ timeout: 10_000 });
    assert(
      (await page.url()).endsWith('#api-edge-variant-4'),
      'Diagram prop selection did not update the deep-link fragment.',
    );
  });

  for (const name of requiredDiagramStories) {
    assert(
      diagramEntries.some((entry) => entry.name === name),
      `Diagram variant ${name} is absent from index.json.`,
    );
  }

  const aiFamilies = [
    'checkbox',
    'form',
    'select',
    'data-table',
    'modal',
    'tag',
    'date-picker',
    'number-input',
    'text-input',
    'dropdown',
    'radio-button',
    'tile',
  ];
  for (const [label, entry, theme] of [
    ['Carbon for AI white', carbonForAiWhite, 'white'],
    ['Carbon for AI g10', carbonForAiG10, 'g10'],
    ['Carbon for AI g90', carbonForAiG90, 'g90'],
    ['Carbon for AI g100', carbonForAiG100, 'g100'],
  ]) {
    await check(label, async () => {
      await visit(entry, label);
      await page
        .locator(`[data-ai-theme="${theme}"]`)
        .waitFor({ timeout: 10_000 });
      const families = await page
        .locator('[data-ai-family]')
        .evaluateAll((elements) =>
          elements.map((element) => element.getAttribute('data-ai-family')),
        );
      assert(
        JSON.stringify(families) === JSON.stringify(aiFamilies),
        `${label} does not render the complete Carbon for AI family set.`,
      );
      await page
        .getByRole('button', { name: 'Open AI presence modal' })
        .waitFor({
          timeout: 10_000,
        });
      assert(
        (await page.getByRole('dialog').count()) === 0,
        `${label} opens its modal before a user requests it.`,
      );
    });
  }

  await check('Local Markdown chapter and fragment links', async () => {
    await page.goto(`${origin}/?path=/docs/knowledge-base-readme--docs`, {
      timeout: 20_000,
      waitUntil: 'domcontentloaded',
    });
    await assertManagerDocs('Knowledge base README');
    const docs = page.frameLocator('#storybook-preview-iframe');
    const orientation = docs.getByRole('link', {
      name: 'Orientation and adoption boundary',
    });
    await orientation.waitFor({ timeout: 20_000 });
    assert(
      (await orientation.getAttribute('href')) ===
        '/?path=/docs/knowledge-base-01-orientation--docs',
      'README chapter link is not rewritten to a local Docs target.',
    );
    assert(
      (await orientation.getAttribute('target')) === '_parent',
      'README chapter link does not navigate the local Storybook shell.',
    );
    await orientation.click();
    await page.waitForURL(
      /\?path=\/docs\/knowledge-base-01-orientation--docs$/,
      { timeout: 20_000 },
    );
    await assertManagerDocs('Knowledge base orientation');

    await page.goto(
      `${origin}/?path=/docs/knowledge-base-05-components--docs`,
      {
        timeout: 20_000,
        waitUntil: 'domcontentloaded',
      },
    );
    await assertManagerDocs('Knowledge base components');
    const patterns = page
      .frameLocator('#storybook-preview-iframe')
      .getByRole('link', { name: 'Global header pattern' });
    await patterns.waitFor({ timeout: 20_000 });
    const fragmentHref = await patterns.getAttribute('href');
    assert(
      fragmentHref ===
        '/?path=/docs/knowledge-base-06-patterns--docs#global-header',
      'Cross-chapter fragment link is not rewritten to a local Docs target.',
    );
    await patterns.click();
    await page.waitForURL(
      /\?path=\/docs\/knowledge-base-06-patterns--docs#global-header$/,
      { timeout: 20_000 },
    );
    await assertManagerDocs('Knowledge base patterns fragment');
  });

  if (remoteRequests.size) {
    failures.push(`Remote requests found:\n${[...remoteRequests].join('\n')}`);
  }
  if (failures.length) {
    throw new Error(
      `Offline workbench audit failed:\n${failures.join('\n\n')}`,
    );
  }
  console.log(
    `Static workbench verified: ${entries.length} stories, ${flags.length}/${flags.length} installed flags, ${providerProps.length} runtime provider props, ${chartEntries.length} charts, and ${diagramEntries.length} diagrams.`,
  );
} finally {
  await browser.close();
  await new Promise((close) => server.close(close));
}
