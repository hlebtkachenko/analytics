// Visual gate for the documents and inbox pages; run by hand: node scripts/visual-gate.mjs [outputDir].
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { chromium } from '@playwright/test';

const baseURL =
  process.env.BAP_OPERATIONAL_BASE_URL ?? 'http://localhost:39100';
const slug = process.env.BAP_OPERATIONAL_ORGANIZATION_SLUG ?? 'bap-operational';
const email = process.env.BAP_OPERATIONAL_EMAIL ?? 'owner@bap.invalid';
const password = process.env.BAP_OPERATIONAL_PASSWORD ?? '';
const outDir = path.resolve(process.argv[2] ?? 'test-results/visual-gate');

// The classic scrollbar override, injected on every page so a gutter is measurable.
const scrollbarCss = '::-webkit-scrollbar { width: 15px; height: 15px }';

// The elements whose left and right edges the gate reads, by a resilient selector.
const measured = [
  ['page title', 'h1'],
  ['entity multiselect', '.cds--multi-select'],
  [
    'stat tiles row',
    '[aria-label="Document statistics"], [data-testid="analytics-stats"]',
  ],
  ['tabs row', '.cds--tabs'],
  ['grid container', '.cds--data-table-container'],
  ['table', 'table'],
  ['pagination footer', '.cds--pagination'],
  ['summary tile', '.cds--tile'],
  ['detail tabs', '[role="tablist"]'],
];

async function signIn(page) {
  await page.goto(`${baseURL}/sign-in`);
  await page.getByLabel('Email address').fill(email);
  await page.locator('input[name="password"]').fill(password);
  const submit = page.getByRole('button', { name: 'Sign in' });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const pending = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/auth/sign-in/email',
    );
    await submit.click();
    const response = await pending;
    if (response.ok()) {
      return;
    }
    if (response.status() !== 429) {
      throw new Error(`Sign-in failed with ${response.status()}.`);
    }
    const retry = Number.parseInt(
      response.headers()['x-retry-after'] ?? '',
      10,
    );
    const wait =
      (Number.isFinite(retry) && retry > 0 ? Math.min(retry, 60) : 60) + 1;
    await page.waitForTimeout(wait * 1000);
  }
  throw new Error('Sign-in stayed rate limited.');
}

async function discoverIds(page) {
  // The BFF keys by organization id, so read it from the page's own documents request.
  let orgId = null;
  page.on('request', (request) => {
    const match = /\/organizations\/([^/]+)\/documents/.exec(request.url());
    if (match !== null && orgId === null) {
      orgId = match[1];
    }
  });
  await page.goto(`${baseURL}/documents?organization=${slug}`, {
    waitUntil: 'load',
  });
  await page.waitForTimeout(1000);
  if (orgId === null) {
    throw new Error('Could not resolve the organization id.');
  }
  const base = `/api/bff/application/organizations/${orgId}`;
  const docs = await page.request.get(`${base}/documents?pageSize=100`);
  const documents = (await docs.json()).documents ?? [];
  const invoice = documents.find((d) =>
    ['issued_invoice', 'received_invoice'].includes(d.kind),
  );
  const other = documents.find(
    (d) => !['issued_invoice', 'received_invoice'].includes(d.kind),
  );
  const items = await page.request.get(`${base}/inbox/items?pageSize=25`);
  const list = (await items.json()).items ?? [];
  // The item that renders an inline text preview: a .csv or .txt original in the list.
  const textItem = list.find(
    (entry) =>
      typeof entry.primaryFilename === 'string' &&
      /\.(csv|txt)$/i.test(entry.primaryFilename),
  );
  return {
    invoiceId: invoice?.id,
    otherId: other?.id ?? documents[0]?.id,
    itemId: list[0]?.id,
    textItemId: textItem?.id ?? list[0]?.id,
  };
}

async function measure(page) {
  return page.evaluate((selectors) => {
    const round = (n) => Math.round(n * 100) / 100;
    const rows = [];
    for (const [label, selector] of selectors) {
      const node = document.querySelector(selector);
      if (node === null) {
        continue;
      }
      // The detail h1 is icon-indented, so the title edge is read from its row.
      const measuredNode =
        label === 'page title' && node.parentElement !== null
          ? node.parentElement
          : node;
      const rect = measuredNode.getBoundingClientRect();
      // A hidden tab panel measures 0 by 0; those never carry a page edge.
      if (rect.width === 0 && rect.height === 0) {
        continue;
      }
      rows.push({
        label,
        left: round(rect.left),
        right: round(rect.right),
        width: round(rect.width),
      });
    }
    const docEl = document.documentElement;
    // The tallest empty preview box; a rendered PDF, image or text never counts.
    let tallEmptyPreview = 0;
    for (const box of document.querySelectorAll('[class*="preview"]')) {
      if (box.tagName === 'IFRAME' || box.tagName === 'IMG') {
        continue;
      }
      const rect = box.getBoundingClientRect();
      const empty =
        box.querySelector('iframe, img') === null &&
        (box.textContent ?? '').trim().length === 0;
      if (empty && rect.height > tallEmptyPreview) {
        tallEmptyPreview = Math.round(rect.height);
      }
    }
    return {
      rows,
      overflow: docEl.scrollWidth - docEl.clientWidth,
      scrollWidth: docEl.scrollWidth,
      clientWidth: docEl.clientWidth,
      tallEmptyPreview,
    };
  }, measured);
}

function reportTable(name, data) {
  console.log(`\n### ${name}`);
  console.log(
    `overflow(scrollWidth-clientWidth)=${data.overflow} (scrollWidth=${data.scrollWidth}, clientWidth=${data.clientWidth}); tallestEmptyPreview=${data.tallEmptyPreview}px`,
  );
  console.log('element | left | right | width');
  for (const row of data.rows) {
    console.log(`${row.label} | ${row.left} | ${row.right} | ${row.width}`);
  }
  // Every visible framing element shares the page-grid left edge.
  const lefts = data.rows.map((r) => r.left);
  const leftSpread =
    lefts.length > 0 ? Math.max(...lefts) - Math.min(...lefts) : 0;
  // Only always-full-width blocks are checked for a shared right edge.
  const fullWidth = new Set([
    'stat tiles row',
    'grid container',
    'pagination footer',
  ]);
  const rights = data.rows
    .filter((r) => fullWidth.has(r.label))
    .map((r) => r.right);
  const rightSpread =
    rights.length > 0 ? Math.max(...rights) - Math.min(...rights) : 0;
  const flags = [];
  if (leftSpread > 1)
    flags.push(`LEFT edges spread ${leftSpread.toFixed(2)}px`);
  if (rightSpread > 1)
    flags.push(
      `RIGHT edges (full-width blocks) spread ${rightSpread.toFixed(2)}px`,
    );
  if (data.overflow > 0) flags.push(`HORIZONTAL overflow ${data.overflow}px`);
  if (data.tallEmptyPreview > 400)
    flags.push(`EMPTY preview ${data.tallEmptyPreview}px > 400px`);
  console.log(
    flags.length === 0 ? 'flags: none' : `flags: ${flags.join('; ')}`,
  );
}

const errorNotificationSelector =
  '.cds--inline-notification--error, .cds--actionable-notification--error';

// Navigate and settle; one retry absorbs a rate limit, a second error notification throws.
async function gotoStable(page, url) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    // The new-document form keeps a request open, so wait for load plus a fixed settle.
    await page.goto(`${baseURL}${url}`, { waitUntil: 'load' });
    await page.waitForTimeout(1200);
    const errors = await page.locator(errorNotificationSelector).count();
    if (errors === 0) {
      return;
    }
    if (attempt === 0) {
      console.log(
        `  ${url}: ${errors} error notification(s), retrying after a pause`,
      );
      await page.waitForTimeout(8000);
      continue;
    }
    const texts = await page
      .locator(
        '.cds--inline-notification__title, .cds--actionable-notification__title, .cds--inline-notification__subtitle',
      )
      .allInnerTexts();
    throw new Error(`Error notification on ${url}: ${texts.join(' | ')}`);
  }
}

async function capture(page, name, url, viewport, rail, waitSelector) {
  await page.setViewportSize(viewport);
  await gotoStable(page, url);
  await page.addStyleTag({ content: scrollbarCss }).catch(() => {});
  // Late content names an anchor; wait until it carries text.
  if (waitSelector) {
    await page
      .locator(waitSelector)
      .filter({ hasText: /\S/ })
      .first()
      .waitFor();
  }
  const suffix = `${viewport.width}x${viewport.height}${rail ? '-rail' : ''}`;
  const file = path.join(outDir, `${name}-${suffix}.png`);
  await page.screenshot({ path: file, fullPage: false });
  const data = await measure(page);
  reportTable(`${name} @ ${suffix}`, data);
  // Pace the run so 22 navigations never trip the API rate limit.
  await page.waitForTimeout(400);
}

// Extra shot: the inbox with its upload modal open, failing on any error notification.
async function captureInboxUploadModal(page, url) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoStable(page, url);
  await page.addStyleTag({ content: scrollbarCss }).catch(() => {});
  await page.getByRole('button', { name: 'Upload' }).click();
  await page.getByRole('dialog', { name: 'Upload files' }).waitFor();
  const errors = await page.locator(errorNotificationSelector).count();
  if (errors > 0) {
    const texts = await page
      .locator(
        '.cds--inline-notification__title, .cds--actionable-notification__title, .cds--inline-notification__subtitle',
      )
      .allInnerTexts();
    throw new Error(
      `Error notification on the inbox upload modal: ${texts.join(' | ')}`,
    );
  }
  const file = path.join(outDir, 'inbox-upload-modal-1440x900.png');
  await page.screenshot({ path: file, fullPage: false });
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch();
  // One context and page for the run keeps the API load low.
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  await page.addInitScript((css) => {
    const style = document.createElement('style');
    style.textContent = css;
    document.documentElement.appendChild(style);
  }, scrollbarCss);
  await signIn(page);
  const ids = await discoverIds(page);

  const q = `?organization=${encodeURIComponent(slug)}`;
  const pages = [
    ['documents', `/documents${q}`],
    ['document-invoice', `/documents/${ids.invoiceId}${q}`],
    ['document-other', `/documents/${ids.otherId}${q}`],
    ['document-new', `/documents/new${q}`],
    ['documents-analytics', `/documents/analytics${q}`],
    ['inbox', `/inbox${q}`],
    ['inbox-item', `/inbox/${ids.itemId}${q}`],
  ];
  const viewports = [
    { width: 1440, height: 900 },
    { width: 1056, height: 900 },
  ];

  for (const [name, url] of pages) {
    for (const viewport of viewports) {
      await capture(page, name, url, viewport, false);
    }
  }
  // The three inbox settings pages and the inline text preview, shot at 1440x900 only.
  const wide = { width: 1440, height: 900 };
  await capture(page, 'inbox-rules', `/inbox/rules${q}`, wide, false);
  await capture(page, 'inbox-settings', `/inbox/settings${q}`, wide, false);
  await capture(page, 'inbox-channels', `/inbox/channels${q}`, wide, false);
  await capture(
    page,
    'inbox-text-item',
    `/inbox/${ids.textItemId}${q}`,
    wide,
    false,
    'pre',
  );
  // The upload modal is a state the page loop never reaches, so it is shot on its own.
  await captureInboxUploadModal(page, `/inbox${q}`);
  // The demo owner's theme is system, so a dark OS preference proves the charts follow the g100 theme.
  await page.emulateMedia({ colorScheme: 'dark' });
  await capture(
    page,
    'documents-analytics-dark',
    `/documents/analytics${q}`,
    wide,
    false,
  );
  await page.emulateMedia({ colorScheme: 'light' });
  // Rail-expanded pass: pin the rail by cookie and reshoot at 1440.
  await context.addCookies([
    { name: 'bap_rail', value: 'pinned', url: baseURL },
  ]);
  for (const [name, url] of pages) {
    await capture(page, name, url, { width: 1440, height: 900 }, true);
  }

  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
