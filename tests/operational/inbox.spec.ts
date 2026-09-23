import { crc32 } from 'node:zlib';

import type { Locator, Page } from '@playwright/test';

import { expectNoAccessibilityViolations } from './accessibility-support';
import { expect, test } from './authenticated-test';
import {
  ensureLegalEntity,
  ensurePartner,
  resolveLegalEntityId,
} from './legal-entity-support';

const organizationId =
  process.env.BAP_OPERATIONAL_ORGANIZATION_ID ?? 'bap-operational';
const organizationSlug =
  process.env.BAP_OPERATIONAL_ORGANIZATION_SLUG ?? 'bap-operational';
const password = process.env.BAP_OPERATIONAL_PASSWORD ?? '';

// Neutral placeholders: this repository never carries real company data, and the stack is disposable.
const entityName = 'Placeholder Inbox Entity';
const partnerName = 'Demo Supplier s.r.o.';
const partnerRegistrationNumber = '12345678';
// The synthetic member the bulk assign hands two items to; created by the demo with this fixed name.
const memberName = 'Operational Member';

// File names, references and external ids carry a per-run suffix, so a re-run seeds its own set.
const runSuffix = Date.now().toString(36);
const sharedReference = `INBOX-2026-0001-${runSuffix}`;
const csvReference = `INBOX-2026-0002-${runSuffix}`;
const pdfFilename = `placeholder-scan-${runSuffix}.pdf`;
const pngFilename = `placeholder-photo-${runSuffix}.png`;
const csvFilename = `placeholder-table-${runSuffix}.csv`;
const textFilename = `placeholder-note-${runSuffix}.txt`;
const ruledPdfFilename = `placeholder-ruled-${runSuffix}.pdf`;
const csvDocumentTitle = `Placeholder tabular document ${runSuffix}`;
// The two received invoices the demo registers so the reviewed stack has analytics data.
const firstInvoiceReference = `INBOX-INV-0001-${runSuffix}`;
const secondInvoiceReference = `INBOX-INV-0002-${runSuffix}`;

// Fixed real-world filenames the drop zone must accept as-is: diacritics, spaces and a plus sign.
const dropZonePdfFilename = 'ABA-SMLOUVA+O+NÁJMU+BYTU.pdf';
const dropZonePngFilename = 'Snímek obrazovky 2026-09-17 v 21.50.37.png';

const organizationPath = `/api/bff/application/organizations/${organizationId}`;
const partnersPath = `${organizationPath}/partners`;
const legalEntitiesPath = `${organizationPath}/legal-entities`;
const channelsPath = `${organizationPath}/inbox/channels`;
const itemsPath = `${organizationPath}/inbox/items`;
const documentsPath = `${organizationPath}/documents`;
const intakePath = '/api/intake/v1/items';

// A one-page PDF written by hand: catalog, pages, one empty page, an info dictionary and a correct xref table.
function pdfBytes(marker: string): Buffer {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>',
    `<< /Producer (${marker}) >>`,
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, 'latin1'));
    body += `${String(index + 1)} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(body, 'latin1');
  body += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R /Info 4 0 R >>\nstartxref\n${String(xrefOffset)}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

// A 1 by 1 transparent PNG with a per-run text chunk before IEND, so its bytes never repeat an earlier run's exact duplicate.
function pngBytes(marker: string): Buffer {
  const base = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
  );
  const typeAndData = Buffer.concat([
    Buffer.from('tEXt'),
    Buffer.from(`Comment\0${marker}`, 'latin1'),
  ]);
  const chunk = Buffer.alloc(typeAndData.length + 8);
  chunk.writeUInt32BE(typeAndData.length - 4, 0);
  typeAndData.copy(chunk, 4);
  chunk.writeUInt32BE(crc32(typeAndData), typeAndData.length + 4);
  const iendOffset = base.length - 12;
  return Buffer.concat([
    base.subarray(0, iendOffset),
    chunk,
    base.subarray(iendOffset),
  ]);
}
const csvBytes = Buffer.from(
  `code,description,amount\nsite-a,placeholder material ${runSuffix},100.00\nsite-b,placeholder labour,200.00\n`,
);
const textBytes = Buffer.from(
  `Placeholder note ${runSuffix}: a plain text payload with nothing tabular in it.\n`,
);

type IntakeAnswer = Readonly<{
  duplicateOfItemId: string | null;
  itemId: string;
  status: string;
}>;

type ItemDetail = Readonly<{
  item: Readonly<{
    decidedByKind: string | null;
    documentId: string | null;
    status: string;
  }>;
}>;

type DocumentDetail = Readonly<{
  document: Readonly<{ id: string; version: number }>;
  supersedesDocumentId: string | null;
}>;

let legalEntityId = '';
let channelId = '';
// The plain secret is held here for the run and never written anywhere else.
let intakeSecret = '';
let pdfItemId = '';
let pngItemId = '';
let csvItemId = '';
let textItemId = '';
let duplicateItemId = '';
let pdfDocumentId = '';
let csvDocumentId = '';
let versionDocumentIdForPage = '';
let firstInvoiceDocumentId = '';
let secondInvoiceDocumentId = '';

// The public push route: the bearer secret alone names the channel, the file part carries the bytes.
async function pushFile(
  page: Page,
  name: string,
  mimeType: string,
  buffer: Buffer,
  externalId: string,
): Promise<IntakeAnswer> {
  const pushed = await page.request.post(intakePath, {
    headers: { authorization: `Bearer ${intakeSecret}` },
    multipart: { externalId, file: { buffer, mimeType, name } },
  });
  expect(pushed.status(), `${name} was refused by the intake.`).toBe(202);
  return (await pushed.json()) as IntakeAnswer;
}

async function readItem(page: Page, itemId: string): Promise<ItemDetail> {
  const read = await page.request.get(
    `${itemsPath}/${encodeURIComponent(itemId)}`,
  );
  expect(read.status()).toBe(200);
  return (await read.json()) as ItemDetail;
}

async function readDocument(
  page: Page,
  documentId: string,
): Promise<DocumentDetail> {
  const read = await page.request.get(
    `${documentsPath}/${encodeURIComponent(documentId)}`,
  );
  expect(read.status()).toBe(200);
  return (await read.json()) as DocumentDetail;
}

function withOrganization(path: string): string {
  return `${path}?organization=${encodeURIComponent(organizationSlug)}`;
}

// The item page titles itself by the filename or sender, so the caller names the title it expects.
async function openItem(
  page: Page,
  itemId: string,
  title: string,
): Promise<void> {
  await page.goto(withOrganization(`/inbox/${encodeURIComponent(itemId)}`));
  await expect(
    page.getByRole('heading', { exact: true, level: 1, name: title }),
  ).toBeVisible();
}

async function openInbox(page: Page): Promise<void> {
  await page.goto(withOrganization('/inbox'));
  await expect(
    page.getByRole('heading', { level: 1, name: 'Inbox' }),
  ).toBeVisible();
}

function itemRow(page: Page, filename: string): Locator {
  return page.getByRole('row').filter({ hasText: filename });
}

// The action-column link is one per data row, so counting them counts the rows the grid actually shows.
async function dataRowCount(page: Page): Promise<number> {
  return page
    .getByRole('table', { name: 'Inbox items' })
    .locator('a[href*="/inbox/"]')
    .count();
}

// The count the tab carries between parentheses, or -1 when the label has none yet.
async function tabCount(page: Page, name: string): Promise<number> {
  const text = await page.getByRole('tab', { name }).innerText();
  const match = /\((\d+)\)/.exec(text);
  return match === null ? -1 : Number(match[1]);
}

// Switch to the named tab, wait for its list to arrive, then prove its count equals the rows it shows.
async function assertTabMatchesRows(page: Page, name: string): Promise<void> {
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().includes('/inbox/items') &&
        response.request().method() === 'GET',
    ),
    page.getByRole('tab', { name }).click(),
  ]);
  await expect
    .poll(
      async () => (await tabCount(page, name)) === (await dataRowCount(page)),
    )
    .toBe(true);
}

// The Overview sections hold the draft fields; the partner is a search picker over the partners BFF.
async function fillDraft(
  page: Page,
  draft: Readonly<{
    kind: string;
    partnerName?: string;
    reference: string;
    title: string;
  }>,
): Promise<void> {
  await page
    .getByLabel('Legal entity', { exact: true })
    .selectOption(legalEntityId);
  await page.getByLabel('Kind', { exact: true }).selectOption(draft.kind);
  await page.getByLabel('Title', { exact: true }).fill(draft.title);
  await page.getByLabel('Document date', { exact: true }).fill('2026-09-01');
  await page.getByLabel('Reference', { exact: true }).fill(draft.reference);
  if (draft.partnerName !== undefined) {
    const partner = page.getByRole('combobox', { name: 'Partner' });
    await partner.click();
    await partner.fill(draft.partnerName);
    await page.getByRole('option', { name: draft.partnerName }).click();
  }
  await page.getByRole('button', { name: 'File as document' }).click();
}

// A routed item shows the "Open document" primary link and no draft; the document id comes from its href.
async function expectRouted(page: Page): Promise<string> {
  const link = page.getByRole('link', { exact: true, name: 'Open document' });
  await expect(link.first()).toBeVisible();
  const href = await link.first().getAttribute('href');
  const match = /\/documents\/([^/?]+)/.exec(href ?? '');
  expect(match, 'The routed item names no document.').not.toBeNull();
  return decodeURIComponent(match![1]!);
}

// A reviewable item shows the "File as document" primary button.
async function expectInReview(page: Page): Promise<void> {
  await expect(
    page.getByRole('button', { name: 'File as document' }),
  ).toBeVisible();
}

// Reopen a routed item through the overflow menu, the verb that replaced the old "Undo route" button.
async function reopenItem(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Reopen' }).click();
}

// The Original panel links each routed item as "Filed from the inbox <date>" by inbox href.
function itemLink(page: Page, itemId: string): Locator {
  return page.locator(`a[href*="/inbox/${itemId}"]:visible`);
}

async function openDocument(page: Page, documentId: string): Promise<void> {
  await page.goto(
    withOrganization(`/documents/${encodeURIComponent(documentId)}`),
  );
  await expect(page.getByRole('list', { name: 'Original' })).toBeVisible();
}

// Registers a received invoice via /documents/new for analytics data and returns its id.
async function registerReceivedInvoice(
  page: Page,
  invoice: Readonly<{ baseAmount: string; reference: string; title: string }>,
): Promise<string> {
  await page.goto(withOrganization('/documents/new'));
  const entity = page.getByLabel('Legal entity', { exact: true });
  await expect(entity).toBeVisible();
  await entity.selectOption(legalEntityId);
  await page
    .getByLabel('Kind', { exact: true })
    .selectOption('received_invoice');
  await page.getByLabel('Title', { exact: true }).fill(invoice.title);
  // The Carbon date picker takes a typed value, then a blur commits the parsed day.
  const date = page.getByLabel('Document date', { exact: true });
  await date.fill('2026-06-15');
  await date.blur();
  await page.getByLabel('Reference', { exact: true }).fill(invoice.reference);
  const partner = page.getByRole('combobox', { name: 'Partner' });
  await partner.click();
  await partner.fill(partnerName);
  await page.getByRole('option', { name: partnerName }).click();
  await page
    .getByLabel('Description 1', { exact: true })
    .fill('placeholder invoice line');
  await page
    .getByLabel('Base amount 1', { exact: true })
    .fill(invoice.baseAmount);
  await page.getByRole('button', { name: 'Register document' }).click();
  // A registered document is opened by its uuid, so the wait never matches /documents/new.
  await page.waitForURL(/\/documents\/[0-9a-fA-F-]{36}/);
  const match = /\/documents\/([0-9a-fA-F-]{36})/.exec(
    new URL(page.url()).pathname,
  );
  expect(match, 'The registered invoice names no document.').not.toBeNull();
  return match![1]!;
}

test.describe
  .serial('inbox items are routed, versioned, attached and ruled', () => {
  test('owner seeds one entity, one partner, an API channel and five pushes', async ({
    page,
  }) => {
    test.skip(password.length === 0, 'BAP_OPERATIONAL_PASSWORD is required.');
    test.setTimeout(180_000);

    await test.step('create the legal entity and the partner', async () => {
      await ensureLegalEntity(page, organizationSlug, entityName);
      legalEntityId = await resolveLegalEntityId(
        page,
        legalEntitiesPath,
        entityName,
      );
      await ensurePartner(page, {
        partnersPath,
        name: partnerName,
        registrationNumber: partnerRegistrationNumber,
        legalEntityId,
      });
    });

    await test.step('create the API channel and issue its credential', async () => {
      const created = await page.request.post(channelsPath, {
        data: { kind: 'api', name: `Placeholder push ${runSuffix}` },
      });
      expect(created.status(), 'The demo channel was refused.').toBe(201);
      channelId = ((await created.json()) as Readonly<{ id: string }>).id;

      const issued = await page.request.post(
        `${channelsPath}/${encodeURIComponent(channelId)}/credentials`,
      );
      expect(issued.status(), 'The demo credential was refused.').toBe(201);
      intakeSecret = ((await issued.json()) as Readonly<{ secret: string }>)
        .secret;
      expect(intakeSecret).toMatch(/^bap_intake_/);
    });

    await test.step('push a PDF, a PNG, a CSV, a text file and the PDF again', async () => {
      const pdf = pdfBytes(`placeholder-${runSuffix}`);
      pdfItemId = (
        await pushFile(
          page,
          pdfFilename,
          'application/pdf',
          pdf,
          `pdf-${runSuffix}`,
        )
      ).itemId;
      pngItemId = (
        await pushFile(
          page,
          pngFilename,
          'image/png',
          pngBytes(`placeholder-${runSuffix}`),
          `png-${runSuffix}`,
        )
      ).itemId;
      csvItemId = (
        await pushFile(
          page,
          csvFilename,
          'text/csv',
          csvBytes,
          `csv-${runSuffix}`,
        )
      ).itemId;
      textItemId = (
        await pushFile(
          page,
          textFilename,
          'text/plain',
          textBytes,
          `txt-${runSuffix}`,
        )
      ).itemId;

      // The same bytes under a new external id: discarded at arrival as an exact duplicate.
      const again = await pushFile(
        page,
        pdfFilename,
        'application/pdf',
        pdf,
        `pdf-again-${runSuffix}`,
      );
      expect(again.status).toBe('discarded');
      expect(again.duplicateOfItemId).toBe(pdfItemId);
      duplicateItemId = again.itemId;
    });
  });

  test('two received invoices are registered through the new document form', async ({
    page,
  }) => {
    test.skip(password.length === 0, 'BAP_OPERATIONAL_PASSWORD is required.');
    test.setTimeout(120_000);

    await test.step('the first invoice opens on its Lines tab', async () => {
      firstInvoiceDocumentId = await registerReceivedInvoice(page, {
        baseAmount: '10000.00',
        reference: firstInvoiceReference,
        title: `Placeholder inbox invoice one ${runSuffix}`,
      });
      // A received invoice opens on Lines, which proves the registration carried a line.
      await expect(page.getByRole('tab', { name: /^Lines/ })).toHaveAttribute(
        'aria-selected',
        'true',
      );
    });

    await test.step('the second invoice gives analytics a second document', async () => {
      secondInvoiceDocumentId = await registerReceivedInvoice(page, {
        baseAmount: '5000.00',
        reference: secondInvoiceReference,
        title: `Placeholder inbox invoice two ${runSuffix}`,
      });
      expect(secondInvoiceDocumentId).not.toBe(firstInvoiceDocumentId);
    });
  });

  test('the list shows the sniffed types, the tab counts and the discarded duplicate', async ({
    page,
  }) => {
    test.skip(password.length === 0, 'BAP_OPERATIONAL_PASSWORD is required.');
    test.setTimeout(120_000);

    await test.step('the To review tab carries the four items with their detected types', async () => {
      await openInbox(page);
      // The detected type is now the item icon's tooltip, not a column.
      await expect(
        itemRow(page, pdfFilename).locator('[title="pdf"]'),
      ).toBeVisible();
      await expect(
        itemRow(page, pngFilename).locator('[title="image"]'),
      ).toBeVisible();
      await expect(
        itemRow(page, csvFilename).locator('[title="tabular"]'),
      ).toBeVisible();
      await expect(
        itemRow(page, textFilename).locator('[title="text"]'),
      ).toBeVisible();
    });

    await test.step('the title, tab row, grid container and table share the page-grid edges', async () => {
      const box = async (locator: Locator) => {
        const rect = await locator.boundingBox();
        expect(rect).not.toBeNull();
        return rect!;
      };
      const title = await box(
        page.getByRole('heading', { level: 1, name: 'Inbox' }),
      );
      const tabs = await box(page.getByRole('tablist').first());
      const container = await box(page.locator('.cds--data-table-container'));
      const table = await box(page.getByRole('table', { name: 'Inbox items' }));
      // Every row starts at one left edge.
      expect(Math.abs(title.x - tabs.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(title.x - container.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(title.x - table.x)).toBeLessThanOrEqual(1);
      // The list paginates and grows, so it never opens a vertical scrollbar gutter.
      expect(
        Math.abs(container.x + container.width - (table.x + table.width)),
      ).toBeLessThanOrEqual(1);
    });

    await test.step('every tab count matches its rows and no code or timestamp leaks', async () => {
      // The To review tab is already open, so it needs no click before the count check.
      await expect
        .poll(
          async () =>
            (await tabCount(page, 'To review')) === (await dataRowCount(page)),
        )
        .toBe(true);
      await assertTabMatchesRows(page, 'Filed');
      await assertTabMatchesRows(page, 'Discarded');
      await assertTabMatchesRows(page, 'All');

      // The All tab shows every status word and decided-by line, so it proves no raw code or ISO time reaches the screen.
      const mainText = await page.locator('main').innerText();
      expect(mainText).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
      expect(mainText).not.toMatch(/needs_review|target_default/);
    });

    await test.step('the Discarded tab shows the duplicate pointing at the first PDF', async () => {
      await page.getByRole('tab', { name: 'Discarded' }).click();
      await expect(itemRow(page, pdfFilename).first()).toContainText(
        'Discarded',
      );
      // The discarded duplicate is opened directly; its header links back to the earlier item.
      await page.goto(
        withOrganization(`/inbox/${encodeURIComponent(duplicateItemId)}`),
      );
      await expect(
        page.getByRole('link', { name: 'Duplicate of an earlier item' }),
      ).toHaveAttribute('href', new RegExp(`/inbox/${pdfItemId}`));
    });
  });

  test('the inbox list has no accessibility violations', async ({ page }) => {
    test.skip(password.length === 0, 'BAP_OPERATIONAL_PASSWORD is required.');
    await openInbox(page);
    // The grid shows a header-only skeleton until the items arrive; axe must see the loaded table.
    await expect(itemRow(page, pdfFilename)).toBeVisible();
    await expectNoAccessibilityViolations(page, 'inbox list');
  });

  test('the PDF item takes a note, walks its neighbours, routes, reopens and routes again', async ({
    page,
  }) => {
    test.skip(password.length === 0, 'BAP_OPERATIONAL_PASSWORD is required.');
    test.setTimeout(120_000);

    await test.step('Prev and Next walk the review tab from the PDF item', async () => {
      await openItem(page, pdfItemId, pdfFilename);
      const next = page.getByRole('button', { exact: true, name: 'Next' });
      const previous = page.getByRole('button', {
        exact: true,
        name: 'Previous',
      });
      // At least one neighbour exists once the tab's first page has loaded.
      await expect
        .poll(
          async () => (await next.isEnabled()) || (await previous.isEnabled()),
        )
        .toBe(true);
      if (await next.isEnabled()) {
        await next.click();
      } else {
        await previous.click();
      }
      await expect(page).not.toHaveURL(
        new RegExp(`/inbox/${pdfItemId}(\\?|$)`),
      );
    });

    await test.step('the item page shows the file and no accessibility violation', async () => {
      await openItem(page, pdfItemId, pdfFilename);
      await expect(
        page.getByRole('link', { name: `Download ${pdfFilename}` }),
      ).toBeVisible();
      await expectNoAccessibilityViolations(page, 'inbox item');
    });

    await test.step('a note set through the hints route shows in the header', async () => {
      // The page no longer sets hints; the channels still do, so the note is set through the BFF and shown read only.
      const patched = await page.request.patch(
        `${itemsPath}/${encodeURIComponent(pdfItemId)}/hints`,
        { data: { hintText: 'placeholder scan of a signed order' } },
      );
      expect(patched.status()).toBe(200);
      await openItem(page, pdfItemId, pdfFilename);
      await expect(
        page.getByText('Note: placeholder scan of a signed order'),
      ).toBeVisible();
    });

    await test.step('the item is routed to Documents as other with a reference', async () => {
      await fillDraft(page, {
        kind: 'other',
        partnerName,
        reference: sharedReference,
        title: `Placeholder scanned order ${runSuffix}`,
      });
      await expectRouted(page);
    });

    await test.step('reopen returns the item to review and the route is repeated', async () => {
      await reopenItem(page);
      await expectInReview(page);
      await fillDraft(page, {
        kind: 'other',
        partnerName,
        reference: sharedReference,
        title: `Placeholder scanned order ${runSuffix}`,
      });
      pdfDocumentId = await expectRouted(page);
    });

    await test.step('the document page lists the PDF as its original and links back to the inbox item', async () => {
      await openDocument(page, pdfDocumentId);
      const originals = page.getByRole('list', { name: 'Original' });
      await expect(originals.getByRole('listitem')).toHaveCount(1);
      await expect(originals).toContainText(pdfFilename);
      await expect(itemLink(page, pdfItemId)).toBeVisible();
      await expectNoAccessibilityViolations(page, 'document page');
      // The Original tab's "Filed from the inbox" link closes the loop back to the item.
      await itemLink(page, pdfItemId).first().click();
      await expect(page).toHaveURL(new RegExp(`/inbox/${pdfItemId}`));
      await expect(
        page.getByRole('link', { exact: true, name: 'Open document' }),
      ).toBeVisible();
    });
  });

  test('the CSV item becomes a document and the text item is discarded and restored', async ({
    page,
  }) => {
    test.skip(password.length === 0, 'BAP_OPERATIONAL_PASSWORD is required.');
    test.setTimeout(120_000);

    await test.step('the CSV is routed as an other document', async () => {
      await openItem(page, csvItemId, csvFilename);
      // The CSV original renders inline as text, read from the download route.
      await expect(page.locator('pre')).toContainText(
        `placeholder material ${runSuffix}`,
      );
      await fillDraft(page, {
        kind: 'other',
        reference: csvReference,
        title: csvDocumentTitle,
      });
      csvDocumentId = await expectRouted(page);
      await openDocument(page, csvDocumentId);
      await expect(page.getByRole('list', { name: 'Original' })).toContainText(
        csvFilename,
      );
    });

    await test.step('the text payload is discarded and restored', async () => {
      await openItem(page, textItemId, textFilename);
      // The plain text original renders inline, read from the download route.
      await expect(page.locator('pre')).toContainText(
        `Placeholder note ${runSuffix}`,
      );
      await page.getByRole('button', { name: 'More actions' }).click();
      await page.getByRole('menuitem', { name: 'Discard' }).click();
      const modal = page.getByRole('dialog', { name: 'Discard item' });
      await modal.getByLabel('Discard reason').selectOption('irrelevant');
      await modal.getByRole('button', { exact: true, name: 'Discard' }).click();
      await expect(
        page.getByRole('button', { exact: true, name: 'Restore' }),
      ).toBeVisible();
      await page.getByRole('button', { exact: true, name: 'Restore' }).click();
      await expectInReview(page);
    });
  });

  test('the PNG item is attached to the CSV document and the attach is undone', async ({
    page,
  }) => {
    test.skip(password.length === 0, 'BAP_OPERATIONAL_PASSWORD is required.');
    test.setTimeout(120_000);

    await test.step('the attach modal finds the CSV document by title', async () => {
      await openItem(page, pngItemId, pngFilename);
      await page.getByRole('button', { name: 'More actions' }).click();
      await page.getByRole('menuitem', { name: 'Attach to document' }).click();
      const modal = page.getByRole('dialog', {
        name: 'Attach to existing document',
      });
      await modal.getByRole('combobox').fill(csvDocumentTitle);
      await page.getByRole('option', { name: csvDocumentTitle }).click();
      await modal.getByRole('button', { exact: true, name: 'Attach' }).click();
      await expect(page.getByText('Attached to the document.')).toBeVisible();
      expect(await expectRouted(page)).toBe(csvDocumentId);
    });

    await test.step('the Original panel lists both files', async () => {
      await openDocument(page, csvDocumentId);
      const originals = page.getByRole('list', { name: 'Original' });
      await expect(originals.getByRole('listitem')).toHaveCount(2);
      await expect(originals).toContainText(csvFilename);
      await expect(originals).toContainText(pngFilename);
      await expect(itemLink(page, pngItemId)).toBeVisible();
    });

    await test.step('reopen returns the PNG item to review and the document keeps one file', async () => {
      await openItem(page, pngItemId, pngFilename);
      await reopenItem(page);
      await expectInReview(page);
      await openDocument(page, csvDocumentId);
      await expect(
        page.getByRole('list', { name: 'Original' }).getByRole('listitem'),
      ).toHaveCount(1);
    });
  });

  test('two review items are assigned in bulk', async ({ page }) => {
    test.skip(password.length === 0, 'BAP_OPERATIONAL_PASSWORD is required.');
    test.setTimeout(120_000);

    await openInbox(page);
    // Carbon hides the native checkbox under its label, so the label is what a person clicks.
    await page.locator(`label[for="data-grid-select-${pngItemId}"]`).click();
    await page.locator(`label[for="data-grid-select-${textItemId}"]`).click();
    await page.getByRole('button', { name: 'Assign' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Assign' });
    await expect(dialog).toContainText('2 items selected.');
    // The bulk assignee is a member picker now, never a free-text id.
    await dialog.getByLabel('Assignee').selectOption({ label: memberName });
    await dialog.getByRole('button', { name: 'Assign' }).click();
    await expect(page.getByText('2 of 2 items done.')).toBeVisible();

    // The batch bar overlays the toolbar Filter toggle until the selection clears.
    await page.getByRole('button', { name: 'Cancel' }).click();

    // The Assignee column is cut, so the assignment is proved through the assignee filter.
    await page.getByRole('button', { name: 'Filter' }).click();
    await page.getByLabel('Assignee', { exact: true }).selectOption({
      label: memberName,
    });
    await expect(itemRow(page, pngFilename)).toBeVisible();
    await expect(itemRow(page, textFilename)).toBeVisible();
  });

  test('a repeated reference becomes a new version and a repeated partner match is discarded', async ({
    page,
  }) => {
    test.skip(password.length === 0, 'BAP_OPERATIONAL_PASSWORD is required.');
    test.setTimeout(120_000);

    await test.step('the same reference under the same kind raises the conflict banner', async () => {
      await openItem(page, pngItemId, pngFilename);
      await fillDraft(page, {
        kind: 'other',
        partnerName,
        reference: sharedReference,
        title: `Placeholder scanned order v2 ${runSuffix}`,
      });
      await expect(
        page.getByText('A current document already carries this reference.'),
      ).toBeVisible();
    });

    await test.step('registering it as a new version routes the item and supersedes the first document', async () => {
      await page
        .getByRole('button', { name: 'Register as new version' })
        .click();
      const versionDocumentId = await expectRouted(page);
      expect(versionDocumentId).not.toBe(pdfDocumentId);
      const version = await readDocument(page, versionDocumentId);
      expect(version.document.version).toBe(2);
      expect(version.supersedesDocumentId).toBe(pdfDocumentId);
      versionDocumentIdForPage = versionDocumentId;
    });

    await test.step('the same reference under another kind and the same partner raises the duplicate dialog', async () => {
      await openItem(page, textItemId, textFilename);
      await fillDraft(page, {
        kind: 'contract',
        partnerName,
        reference: sharedReference,
        title: `Placeholder duplicate note ${runSuffix}`,
      });
      const dialog = page.getByRole('dialog', {
        name: 'This looks like a duplicate',
      });
      await expect(dialog).toBeVisible();
      await expect(
        dialog.getByRole('list', { name: 'Matching documents' }),
      ).toContainText(sharedReference);
      await dialog
        .getByRole('button', { name: 'Discard as duplicate' })
        .click();
      await expect(
        page.getByRole('button', { exact: true, name: 'Restore' }),
      ).toBeVisible();
      // The old code line "discarded (duplicate)" is now an activity sentence with the actor and reason.
      await page.getByRole('tab', { name: 'Activity' }).click();
      await expect(
        page.getByText(/Discarded by .+ \(Duplicate\)/),
      ).toBeVisible();
    });
  });

  test('the version document page shows the new title, the version tag and the replaces activity', async ({
    page,
  }) => {
    test.skip(password.length === 0, 'BAP_OPERATIONAL_PASSWORD is required.');
    await openDocument(page, versionDocumentIdForPage);
    await expect(
      page.getByRole('heading', {
        name: `Placeholder scanned order v2 ${runSuffix}`,
      }),
    ).toBeVisible();
    // The header carries the version chain as a tag, not a raw number.
    await expect(page.getByText('Version 2', { exact: true })).toBeVisible();
    // The Activity tab names the supersession as a sentence, with the link to the earlier version.
    await page.getByRole('tab', { name: 'Activity' }).click();
    await expect(
      page.getByRole('link', {
        name: 'This document replaces an earlier version',
      }),
    ).toBeVisible();
  });

  test('a routing target default and a rule auto-route the next PDF', async ({
    page,
  }) => {
    test.skip(password.length === 0, 'BAP_OPERATIONAL_PASSWORD is required.');
    // Routing polls the worker up to 60s, so the flow gets room on a slow runner.
    test.setTimeout(240_000);

    await test.step('the pdf target gets the demo entity as its default', async () => {
      await page.goto(withOrganization('/inbox/rules'));
      // The pdf row is a platform default on a fresh stack, so the collapsed Defaults open first.
      await page.getByRole('button', { name: /^Defaults \(\d+\)$/ }).click();
      await page
        .getByRole('button', { name: 'Change what happens to a PDF' })
        .click();
      const dialog = page.getByRole('dialog', { name: 'Edit default' });
      await dialog
        .getByLabel('Legal entity', { exact: true })
        .selectOption(legalEntityId);
      await dialog.getByRole('button', { name: 'Save' }).click();
      await expect(dialog).toBeHidden();
      await expect(
        page.getByRole('list', { name: 'Changed defaults' }),
      ).toContainText(
        `A PDF goes to Documents as Other for ${entityName}; a person confirms every one.`,
      );
    });

    await test.step('the old settings route lands on the rules page and the quota lives in organization settings', async () => {
      await page.goto(withOrganization('/inbox/settings'));
      await expect(page).toHaveURL(
        new RegExp(`/inbox/rules\\?organization=${organizationSlug}$`),
      );
      await page.goto(`/${encodeURIComponent(organizationSlug)}/settings`);
      await expect(
        page.getByRole('heading', { name: 'Inbox storage' }),
      ).toBeVisible();
      await expect(page.getByText(/In use [\d.,]+ MB\./)).toBeVisible();
    });

    await test.step('a rule on the pdf type sets the entity and the kind and routes automatically', async () => {
      await page.goto(withOrganization('/inbox/rules'));
      await page.getByRole('button', { name: 'Create rule' }).click();
      const dialog = page.getByRole('dialog', { name: 'New rule' });
      await dialog
        .getByLabel('Name', { exact: true })
        .fill(`Placeholder pdf rule ${runSuffix}`);
      await dialog.getByLabel('Detected type', { exact: true }).fill('pdf');
      await dialog
        .getByLabel('Legal entity', { exact: true })
        .selectOption(legalEntityId);
      await dialog
        .getByLabel('Document kind', { exact: true })
        .selectOption('other');
      // Carbon hides the switch button under its label, so the label is what a person clicks.
      await dialog.locator('label[for="inbox-rule-auto"]').click();
      await expect(
        dialog.getByRole('switch', { name: 'Route automatically' }),
      ).toBeChecked();
      await dialog.getByRole('button', { name: 'Save' }).click();
      await expect(dialog).toBeHidden();
      await expect(
        page
          .getByRole('row')
          .filter({ hasText: `Placeholder pdf rule ${runSuffix}` }),
      ).toContainText('auto-route');
    });

    await test.step('a new PDF is routed by the worker without a person', async () => {
      const ruled = await pushFile(
        page,
        ruledPdfFilename,
        'application/pdf',
        pdfBytes(`placeholder-ruled-${runSuffix}`),
        `pdf-ruled-${runSuffix}`,
      );
      // The worker routes asynchronously, so the item is polled until the job has run.
      await expect
        .poll(async () => (await readItem(page, ruled.itemId)).item.status, {
          message: 'The rule did not route the new PDF.',
          timeout: 60_000,
        })
        .toBe('routed');

      await openInbox(page);
      await page.getByRole('tab', { name: 'Filed' }).click();
      await expect(itemRow(page, ruledPdfFilename)).toContainText('Filed');
      await openItem(page, ruled.itemId, ruledPdfFilename);
      // The panel spells out the honest derivation, not a false "Complete".
      await expect(
        page
          .getByText(
            `Rule Placeholder pdf rule ${runSuffix} filed it as Other for ${entityName}.`,
          )
          .first(),
      ).toBeVisible();
      await expect(
        page.getByText('Nothing read the file contents yet.').first(),
      ).toBeVisible();
      await expect(
        page.getByRole('link', { exact: true, name: 'Open document' }),
      ).toBeVisible();
    });

    await test.step('the catch-all rule is paused so the reviewed stack auto-files nothing', async () => {
      await page.goto(withOrganization('/inbox/rules'));
      const ruleName = `Placeholder pdf rule ${runSuffix}`;
      await page.getByRole('button', { name: `Disable ${ruleName}` }).click();
      // The rule stays listed but off, so no later PDF Hleb drops is auto-filed.
      await expect(
        page.getByRole('row').filter({ hasText: ruleName }),
      ).toContainText('Off');
    });
  });

  test('a PDF and a PNG are uploaded through the upload modal and appear in the inbox', async ({
    page,
  }) => {
    test.skip(password.length === 0, 'BAP_OPERATIONAL_PASSWORD is required.');
    test.setTimeout(120_000);

    await test.step('drop both files, see the modal items, then find both rows', async () => {
      await openInbox(page);
      // The Upload button opens the Carbon file uploader modal; the drop container input takes the files.
      await page.getByRole('button', { name: 'Upload' }).click();
      const uploadModal = page.getByRole('dialog', { name: 'Upload files' });
      await uploadModal
        .getByLabel('Drag and drop files here or click to upload')
        .setInputFiles([
          {
            buffer: pdfBytes(`drop-zone-${runSuffix}`),
            mimeType: 'application/pdf',
            name: dropZonePdfFilename,
          },
          {
            buffer: pngBytes(`drop-zone-${runSuffix}`),
            mimeType: 'image/png',
            name: dropZonePngFilename,
          },
        ]);

      // A truncated uploader filename repeats in a tooltip, so its title attribute is the one match.
      await expect(
        uploadModal.getByTitle(dropZonePdfFilename, { exact: true }),
      ).toBeVisible();
      await expect(
        uploadModal.getByTitle(dropZonePngFilename, { exact: true }),
      ).toBeVisible();

      // Close the modal so it no longer covers the tabs.
      await uploadModal.getByRole('button', { name: 'Close' }).click();
      await expect(uploadModal).toBeHidden();

      // The All tab shows every status, so both freshly received files are found there by name.
      await page.getByRole('tab', { name: 'All' }).click();
      await expect(itemRow(page, dropZonePdfFilename).first()).toBeVisible();
      await expect(itemRow(page, dropZonePngFilename).first()).toBeVisible();
    });
  });
});
