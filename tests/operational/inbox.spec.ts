import { crc32 } from 'node:zlib';

import type { Locator, Page } from '@playwright/test';

import { expectNoAccessibilityViolations } from './accessibility-support';
import { expect, test } from './authenticated-test';
import { ensureLegalEntity } from './legal-entity-support';

const organizationId =
  process.env.BAP_OPERATIONAL_ORGANIZATION_ID ?? 'bap-operational';
const organizationSlug =
  process.env.BAP_OPERATIONAL_ORGANIZATION_SLUG ?? 'bap-operational';
const password = process.env.BAP_OPERATIONAL_PASSWORD ?? '';

// Neutral placeholders: this repository never carries real company data, and the stack is disposable.
const entityName = 'Placeholder Inbox Entity';
const partnerName = 'Demo Supplier s.r.o.';
const partnerRegistrationNumber = '12345678';

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

type LegalEntityList = Readonly<{
  legalEntities: ReadonlyArray<Readonly<{ id: string; name: string }>>;
}>;

type PartnerList = Readonly<{
  partners: ReadonlyArray<Readonly<{ id: string; name: string }>>;
}>;

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
let partnerId = '';
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

async function resolveLegalEntityId(page: Page): Promise<string> {
  const listed = await page.request.get(legalEntitiesPath);
  expect(listed.status()).toBe(200);
  const body = (await listed.json()) as LegalEntityList;
  const found = body.legalEntities.find((entity) => entity.name === entityName);
  expect(found, 'The demo legal entity is missing.').toBeDefined();
  return found!.id;
}

// A registration number is unique per organization, so an earlier run's partner is reused rather than duplicated.
async function ensurePartner(page: Page): Promise<string> {
  const listed = await page.request.get(
    `${partnersPath}?q=${encodeURIComponent(partnerName)}`,
  );
  expect(listed.status()).toBe(200);
  const existing = ((await listed.json()) as PartnerList).partners.find(
    (partner) => partner.name === partnerName,
  );
  if (existing !== undefined) {
    return existing.id;
  }

  const created = await page.request.post(partnersPath, {
    data: {
      countryCode: 'CZ',
      legalEntityId,
      name: partnerName,
      registrationNumber: partnerRegistrationNumber,
    },
  });
  expect(created.status(), 'The demo partner was refused.').toBe(201);
  return ((await created.json()) as Readonly<{ id: string }>).id;
}

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

async function openItem(page: Page, itemId: string): Promise<void> {
  await page.goto(withOrganization(`/inbox/${encodeURIComponent(itemId)}`));
  await expect(
    page.getByRole('heading', { exact: true, level: 1, name: 'Item' }),
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

// The draft form of an open item: entity, kind, title, date, reference and partner, then the route button.
async function fillDraft(
  page: Page,
  draft: Readonly<{
    kind: string;
    partnerId?: string;
    reference: string;
    title: string;
  }>,
): Promise<void> {
  const form = page.getByRole('form', { name: 'Document draft' });
  await expect(form).toBeVisible();
  // Exact labels: a changed field grows a "Why did X change?" input whose label contains the field name.
  await form
    .getByLabel('Legal entity', { exact: true })
    .selectOption(legalEntityId);
  await form.getByLabel('Kind', { exact: true }).selectOption(draft.kind);
  await form.getByLabel('Title', { exact: true }).fill(draft.title);
  await form.getByLabel('Document date', { exact: true }).fill('2026-09-01');
  await form.getByLabel('Reference', { exact: true }).fill(draft.reference);
  await form
    .getByLabel('Partner id', { exact: true })
    .fill(draft.partnerId ?? '');
  await form.getByRole('button', { name: 'Route to document' }).click();
}

// A routed item loses its draft form and gains the undo button and the document link.
async function expectRouted(page: Page): Promise<string> {
  await expect(page.getByRole('button', { name: 'Undo route' })).toBeVisible();
  const href = await page
    .getByRole('link', { name: 'Open document' })
    .first()
    .getAttribute('href');
  const match = /\/documents\/([^/?]+)/.exec(href ?? '');
  expect(match, 'The routed item names no document.').not.toBeNull();
  return decodeURIComponent(match![1]!);
}

async function expectInReview(page: Page): Promise<void> {
  await expect(
    page.getByRole('button', { name: 'Route to document' }),
  ).toBeVisible();
}

// The Original panel names each routed or attached item by id, linking back to it.
function itemLink(page: Page, itemId: string): Locator {
  return page.getByRole('link', { exact: true, name: itemId });
}

async function openDocument(page: Page, documentId: string): Promise<void> {
  await page.goto(
    withOrganization(`/documents/${encodeURIComponent(documentId)}`),
  );
  await expect(page.getByRole('list', { name: 'Original' })).toBeVisible();
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
      legalEntityId = await resolveLegalEntityId(page);
      partnerId = await ensurePartner(page);
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

  test('the list shows the sniffed types and the discarded duplicate', async ({
    page,
  }) => {
    test.skip(password.length === 0, 'BAP_OPERATIONAL_PASSWORD is required.');
    test.setTimeout(120_000);

    await test.step('the open list carries the four items with their detected types', async () => {
      await openInbox(page);
      await expect(itemRow(page, pdfFilename)).toContainText('pdf');
      await expect(itemRow(page, pngFilename)).toContainText('image');
      await expect(itemRow(page, csvFilename)).toContainText('tabular');
      await expect(itemRow(page, textFilename)).toContainText('text');
    });

    await test.step('the discarded filter shows the duplicate pointing at the first PDF', async () => {
      await page
        .getByLabel('Status', { exact: true })
        .selectOption('discarded');
      await expect(itemRow(page, pdfFilename)).toContainText('Discarded');
      await openItem(page, duplicateItemId);
      await expect(
        page.getByRole('link', { name: 'Duplicate of an earlier item' }),
      ).toHaveAttribute('href', new RegExp(`/inbox/${pdfItemId}`));
    });
  });

  test('the inbox list has no accessibility violations', async ({ page }) => {
    test.skip(password.length === 0, 'BAP_OPERATIONAL_PASSWORD is required.');
    await openInbox(page);
    await expectNoAccessibilityViolations(page, 'inbox list');
  });

  test('the PDF item shows its reasons, takes a hint, routes, undoes and routes again', async ({
    page,
  }) => {
    test.skip(password.length === 0, 'BAP_OPERATIONAL_PASSWORD is required.');
    test.setTimeout(120_000);

    await test.step('the item page shows the sniffed type, the file and the reason', async () => {
      await openItem(page, pdfItemId);
      await expect(page.getByText(/Detected type: pdf/)).toBeVisible();
      await expect(
        page.getByRole('link', { name: `Download ${pdfFilename}` }),
      ).toBeVisible();
      await expect(
        page.getByText(
          'The sniff step found The file starts with the PDF signature.',
        ),
      ).toBeVisible();
      await expectNoAccessibilityViolations(page, 'inbox item');
    });

    await test.step('a hint is saved', async () => {
      const hints = page.getByRole('form', { name: 'Hints' });
      await hints
        .getByLabel('Note for processing')
        .fill('placeholder scan of a signed order');
      await hints.getByRole('button', { name: 'Save hints' }).click();
      await expect(page.getByText('Hints saved.')).toBeVisible();
    });

    await test.step('the item is routed to Documents as other with a reference', async () => {
      await fillDraft(page, {
        kind: 'other',
        partnerId,
        reference: sharedReference,
        title: `Placeholder scanned order ${runSuffix}`,
      });
      await expectRouted(page);
    });

    await test.step('undo returns the item to review and the route is repeated', async () => {
      await page.getByRole('button', { name: 'Undo route' }).click();
      await expectInReview(page);
      await fillDraft(page, {
        kind: 'other',
        partnerId,
        reference: sharedReference,
        title: `Placeholder scanned order ${runSuffix}`,
      });
      pdfDocumentId = await expectRouted(page);
    });

    await test.step('the document page lists the PDF as its original', async () => {
      await openDocument(page, pdfDocumentId);
      const originals = page.getByRole('list', { name: 'Original' });
      await expect(originals.getByRole('listitem')).toHaveCount(1);
      await expect(originals).toContainText(pdfFilename);
      await expect(itemLink(page, pdfItemId)).toBeVisible();
      await expectNoAccessibilityViolations(page, 'document page');
    });
  });

  test('the CSV item becomes a document and the text item is discarded and restored', async ({
    page,
  }) => {
    test.skip(password.length === 0, 'BAP_OPERATIONAL_PASSWORD is required.');
    test.setTimeout(120_000);

    await test.step('the CSV is routed as an other document', async () => {
      await openItem(page, csvItemId);
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
      await openItem(page, textItemId);
      await page.getByLabel('Discard reason').selectOption('irrelevant');
      await page.getByRole('button', { name: 'Discard', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Restore' })).toBeVisible();
      await page.getByRole('button', { name: 'Restore' }).click();
      await expectInReview(page);
    });
  });

  test('the PNG item is attached to the CSV document and the attach is undone', async ({
    page,
  }) => {
    test.skip(password.length === 0, 'BAP_OPERATIONAL_PASSWORD is required.');
    test.setTimeout(120_000);

    await test.step('the attach form finds the CSV document by title', async () => {
      await openItem(page, pngItemId);
      const attach = page.getByRole('form', {
        name: 'Attach to existing document',
      });
      await attach.getByRole('combobox').fill(csvDocumentTitle);
      await page.getByRole('option', { name: csvDocumentTitle }).click();
      await attach.getByRole('button', { name: 'Attach' }).click();
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

    await test.step('undo returns the PNG item to review and the document keeps one file', async () => {
      await openItem(page, pngItemId);
      await page.getByRole('button', { name: 'Undo route' }).click();
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
    await dialog.getByLabel('Assignee').fill('placeholder-reviewer');
    await dialog.getByRole('button', { name: 'Assign' }).click();
    await expect(page.getByText('2 of 2 items done.')).toBeVisible();
    await expect(itemRow(page, pngFilename)).toContainText(
      'placeholder-reviewer',
    );
    await expect(itemRow(page, textFilename)).toContainText(
      'placeholder-reviewer',
    );
  });

  test('a repeated reference becomes a new version and a repeated partner match is discarded', async ({
    page,
  }) => {
    test.skip(password.length === 0, 'BAP_OPERATIONAL_PASSWORD is required.');
    test.setTimeout(120_000);

    await test.step('the same reference under the same kind raises the conflict banner', async () => {
      await openItem(page, pngItemId);
      await fillDraft(page, {
        kind: 'other',
        partnerId,
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
      await openItem(page, textItemId);
      await fillDraft(page, {
        kind: 'contract',
        partnerId,
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
      await expect(page.getByRole('button', { name: 'Restore' })).toBeVisible();
      await expect(page.getByText(/discarded \(duplicate\)/)).toBeVisible();
    });
  });

  test('the version document page shows the new title', async ({ page }) => {
    test.skip(password.length === 0, 'BAP_OPERATIONAL_PASSWORD is required.');
    await openDocument(page, versionDocumentIdForPage);
    await expect(
      page.getByRole('heading', {
        name: `Placeholder scanned order v2 ${runSuffix}`,
      }),
    ).toBeVisible();
  });

  test('a routing target default and a rule auto-route the next PDF', async ({
    page,
  }) => {
    test.skip(password.length === 0, 'BAP_OPERATIONAL_PASSWORD is required.');
    test.setTimeout(150_000);

    await test.step('the pdf target gets the demo entity as its default', async () => {
      await page.goto(withOrganization('/inbox/settings'));
      await page.getByRole('button', { name: 'Edit pdf' }).click();
      const dialog = page.getByRole('dialog', {
        name: 'Routing target for pdf',
      });
      await dialog
        .getByLabel('Default entity', { exact: true })
        .selectOption(legalEntityId);
      await dialog.getByRole('button', { name: 'Save' }).click();
      await expect(dialog).toBeHidden();
      await expect(
        page.getByRole('row').filter({ hasText: 'pdf' }).first(),
      ).toContainText(entityName);
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
      await page.getByLabel('Status', { exact: true }).selectOption('routed');
      await expect(itemRow(page, ruledPdfFilename)).toContainText('Routed');
      await openItem(page, ruled.itemId);
      await expect(page.getByText(/Decided by: Rule/)).toBeVisible();
      await expect(
        page.getByRole('link', { name: 'Open document' }),
      ).toBeVisible();
      // The full page image is the human readable proof the demo command leaves behind.
      await page.screenshot({
        fullPage: true,
        path: 'test-results/inbox-item.png',
      });
    });
  });
});
