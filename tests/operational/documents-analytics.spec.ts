import type { Locator, Page } from '@playwright/test';

import { expectNoAccessibilityViolations } from './accessibility-support';
import { expect, test } from './authenticated-test';
import {
  clearLegalEntities,
  ensureLegalEntity,
  ensurePartner,
  resolveLegalEntityId,
  selectMultiSelectLegalEntities,
} from './legal-entity-support';

const organizationId =
  process.env.BAP_OPERATIONAL_ORGANIZATION_ID ?? 'bap-operational';
const organizationSlug =
  process.env.BAP_OPERATIONAL_ORGANIZATION_SLUG ?? 'bap-operational';
const password = process.env.BAP_OPERATIONAL_PASSWORD ?? '';

// Neutral placeholders: this repository never carries real company data, and the stack is disposable.
const entityName = 'Placeholder Analytics Entity';
const partnerName = 'Demo Supplier s.r.o.';
const partnerRegistrationNumber = '12345678';

// A reference is unique per legal entity and kind, so a re-run seeds its own set instead of colliding.
const runSuffix = Date.now().toString(36);
const fiveMonthReference = `DEMO-2026-0001-${runSuffix}`;

const partnersPath = `/api/bff/application/organizations/${organizationId}/partners`;
const documentsPath = `/api/bff/application/organizations/${organizationId}/documents`;
const legalEntitiesPath = `/api/bff/application/organizations/${organizationId}/legal-entities`;

// The five months the demo invoice covers, each with its own tax point, service period and activity.
const months = [
  { activityCode: 'site-a', end: '2026-01-31', start: '2026-01-01' },
  { activityCode: 'site-b', end: '2026-02-28', start: '2026-02-01' },
  { activityCode: 'site-c', end: '2026-03-31', start: '2026-03-01' },
  { activityCode: 'site-d', end: '2026-04-30', start: '2026-04-01' },
  { activityCode: 'site-e', end: '2026-05-31', start: '2026-05-01' },
] as const;

type WorkLine = Readonly<{
  baseAmount: string;
  category: string;
  description: string;
  vatAmount?: string;
  vatMode: string;
  vatRate: string;
}>;

// The four kinds of work the supplier invoices every month, two standard and two under reverse charge.
const monthlyWork: readonly WorkLine[] = [
  {
    baseAmount: '60000.00',
    category: 'material',
    description: 'placeholder material line',
    vatAmount: '12600.00',
    vatMode: 'standard',
    vatRate: '21.00',
  },
  {
    baseAmount: '50000.00',
    category: 'labour',
    description: 'placeholder labour line',
    vatMode: 'reverse_charge',
    vatRate: '21.00',
  },
  {
    baseAmount: '40000.00',
    category: 'transport',
    description: 'placeholder transport line',
    vatAmount: '8400.00',
    vatMode: 'standard',
    vatRate: '21.00',
  },
  {
    baseAmount: '28999.96',
    category: 'services',
    description: 'placeholder services line',
    vatMode: 'reverse_charge',
    vatRate: '21.00',
  },
];

const fiveMonthItemLines = months.flatMap((month) =>
  monthlyWork.map((work) => ({
    ...work,
    activityCode: month.activityCode,
    periodEnd: month.end,
    periodStart: month.start,
    taxPointDate: month.end,
  })),
);

// Half of the invoice was prepaid, and the paper itemises the deducted advance by VAT regime.
const fiveMonthDeductionLines = [
  {
    baseAmount: '200000.00',
    description: 'placeholder standard advance deduction',
    lineKind: 'advance_deduction',
    vatAmount: '42000.00',
    vatMode: 'standard',
    vatRate: '21.00',
  },
  {
    baseAmount: '258000.00',
    description: 'placeholder reverse charge advance deduction',
    lineKind: 'advance_deduction',
    vatMode: 'reverse_charge',
    vatRate: '21.00',
  },
];

// The amount due is a generated column; formatting differs per locale, so only the digits are asserted.
const amountDuePattern = /500[\s ,.']?000/;

let legalEntityId = '';
let partnerId = '';

async function registerDocument(
  page: Page,
  label: string,
  body: Readonly<Record<string, unknown>>,
): Promise<void> {
  const created = await page.request.post(documentsPath, { data: body });
  expect(created.status(), `${label} was refused.`).toBe(201);
}

test.describe.serial('document analytics read from the stored split', () => {
  test('owner seeds one entity, one partner and five demo documents', async ({
    page,
  }) => {
    test.skip(password.length === 0, 'BAP_OPERATIONAL_PASSWORD is required.');
    // Five registrations each derive an event, so the seed needs more than the shared budget.
    test.setTimeout(180_000);

    await ensureLegalEntity(page, organizationSlug, entityName);
    legalEntityId = await resolveLegalEntityId(
      page,
      legalEntitiesPath,
      entityName,
    );
    partnerId = await ensurePartner(page, {
      partnersPath,
      name: partnerName,
      registrationNumber: partnerRegistrationNumber,
      legalEntityId,
    });

    // D1: the five month received invoice with mixed VAT, two deducted advances and a rounding difference.
    await registerDocument(page, 'The five month invoice', {
      documentDate: '2026-06-01',
      invoice: {
        dueDate: '2026-07-01',
        lines: [...fiveMonthItemLines, ...fiveMonthDeductionLines],
        roundingAmount: '0.20',
        taxPointDate: '2026-05-31',
      },
      kind: 'received_invoice',
      legalEntityId,
      partnerId,
      reference: fiveMonthReference,
      title: 'Placeholder five month invoice',
    });

    // D2: one month, two standard lines, no advance, and a supplier who rounded down.
    await registerDocument(page, 'The single month invoice', {
      documentDate: '2026-07-01',
      invoice: {
        dueDate: '2026-07-31',
        lines: [
          {
            activityCode: 'site-a',
            baseAmount: '10000.00',
            category: 'material',
            description: 'placeholder single month material line',
            periodEnd: '2026-06-30',
            periodStart: '2026-06-01',
            taxPointDate: '2026-06-30',
            vatAmount: '2100.00',
            vatMode: 'standard',
            vatRate: '21.00',
          },
          {
            activityCode: 'site-a',
            baseAmount: '5000.00',
            category: 'services',
            description: 'placeholder single month services line',
            periodEnd: '2026-06-30',
            periodStart: '2026-06-01',
            taxPointDate: '2026-06-30',
            vatAmount: '1050.00',
            vatMode: 'standard',
            vatRate: '21.00',
          },
        ],
        roundingAmount: '-0.30',
        taxPointDate: '2026-06-30',
      },
      kind: 'received_invoice',
      legalEntityId,
      partnerId,
      reference: `DEMO-2026-0002-${runSuffix}`,
      title: 'Placeholder single month invoice',
    });

    // D3: an issued invoice with two supplies and a deducted standard advance.
    await registerDocument(page, 'The issued invoice', {
      documentDate: '2026-04-15',
      invoice: {
        dueDate: '2026-05-15',
        lines: [
          {
            activityCode: 'site-a',
            baseAmount: '30000.00',
            category: 'services',
            description: 'placeholder issued services line',
            periodEnd: '2026-04-30',
            periodStart: '2026-04-01',
            taxPointDate: '2026-04-15',
            vatAmount: '6300.00',
            vatMode: 'standard',
            vatRate: '21.00',
          },
          {
            activityCode: 'site-a',
            baseAmount: '20000.00',
            category: 'goods',
            description: 'placeholder issued goods line',
            periodEnd: '2026-04-30',
            periodStart: '2026-04-01',
            taxPointDate: '2026-04-15',
            vatAmount: '4200.00',
            vatMode: 'standard',
            vatRate: '21.00',
          },
          {
            baseAmount: '10000.00',
            description: 'placeholder issued advance deduction',
            lineKind: 'advance_deduction',
            vatAmount: '2100.00',
            vatMode: 'standard',
            vatRate: '21.00',
          },
        ],
        taxPointDate: '2026-04-15',
      },
      kind: 'issued_invoice',
      legalEntityId,
      partnerId,
      reference: `DEMO-2026-0003-${runSuffix}`,
      title: 'Placeholder issued invoice',
    });

    // D4: an issued invoice whose single supply is exempt, so it carries no VAT at all.
    await registerDocument(page, 'The exempt invoice', {
      documentDate: '2026-03-20',
      invoice: {
        dueDate: '2026-04-20',
        lines: [
          {
            activityCode: 'site-b',
            baseAmount: '15000.00',
            category: 'services',
            description: 'placeholder exempt services line',
            periodEnd: '2026-03-31',
            periodStart: '2026-03-01',
            taxPointDate: '2026-03-20',
            vatMode: 'exempt',
          },
        ],
        taxPointDate: '2026-03-20',
      },
      kind: 'issued_invoice',
      legalEntityId,
      partnerId,
      reference: `DEMO-2026-0004-${runSuffix}`,
      title: 'Placeholder exempt invoice',
    });

    // D5: a kind the rule set does not book, so it stays out of every analytics aggregate.
    await registerDocument(page, 'The contract', {
      attributes: { demo_scope: 'analytics', renewal: 'annual' },
      documentDate: '2026-01-05',
      kind: 'contract',
      legalEntityId,
      partnerId,
      reference: `DEMO-2026-0005-${runSuffix}`,
      title: 'Placeholder framework contract',
      validFrom: '2026-01-05',
      validTo: '2026-12-31',
    });
  });

  test('the analytics page answers every aggregate from the stored columns', async ({
    page,
  }) => {
    test.skip(password.length === 0, 'BAP_OPERATIONAL_PASSWORD is required.');
    test.setTimeout(120_000);

    await page.goto(
      `/documents/analytics?organization=${encodeURIComponent(organizationSlug)}`,
    );
    await selectMultiSelectLegalEntities(page, [entityName]);

    const documents = page.getByTestId('analytics-documents');
    await expect(documents).toBeVisible();
    // The contract carries no economic event, so this run adds four invoice rows; earlier runs may have left more.
    const rows = documents.locator('tbody tr');
    await expect.poll(async () => rows.count()).toBeGreaterThanOrEqual(4);
    const scopedRowCount = await rows.count();

    const fiveMonthRow = documents
      .locator('tbody tr')
      .filter({ hasText: fiveMonthReference });
    await expect(fiveMonthRow).toHaveCount(1);
    await expect(fiveMonthRow).toContainText(amountDuePattern);

    const byMonth = page.getByTestId('analytics-by-month');
    await expect(byMonth).toBeVisible();
    // The month column renders a humanised label, not the stored ISO period.
    for (const month of [
      'January 2026',
      'February 2026',
      'March 2026',
      'April 2026',
      'May 2026',
    ]) {
      await expect(byMonth).toContainText(month);
    }

    const byActivity = page.getByTestId('analytics-by-activity');
    await expect(byActivity).toBeVisible();
    for (const month of months) {
      await expect(byActivity).toContainText(month.activityCode);
    }

    // The regime labels may be humanised, so a separator-tolerant pattern is used for each one.
    const byVatRegime = page.getByTestId('analytics-by-vat-regime');
    await expect(byVatRegime).toBeVisible();
    for (const regime of [
      /reverse[\s_-]?charge/i,
      /standard/i,
      /advance[\s_-]?deduction/i,
    ]) {
      await expect(byVatRegime).toContainText(regime);
    }

    // 548 is the rounding difference, 314 the advance already paid, 321 the payable.
    const byAccount = page.getByTestId('analytics-by-account');
    await expect(byAccount).toBeVisible();
    for (const account of ['548', '314', '321']) {
      await expect(byAccount).toContainText(account);
    }

    // Three stat tiles with counts, never a query budget.
    const stats = page.getByTestId('analytics-stats');
    for (const label of ['Invoices analysed', 'Event lines', 'Invoice lines']) {
      await expect(stats.getByText(label, { exact: true })).toBeVisible();
    }
    await expect(stats).toContainText(/\d/);

    // The scope field's right edge matches the stat tiles' page edge.
    const analyticsBox = async (locator: Locator) => {
      const rect = await locator.boundingBox();
      expect(rect).not.toBeNull();
      return rect!;
    };
    const scopeField = await analyticsBox(
      page.locator('.cds--multi-select').first(),
    );
    const statsBox = await analyticsBox(stats);
    expect(
      Math.abs(scopeField.x + scopeField.width - (statsBox.x + statsBox.width)),
    ).toBeLessThanOrEqual(1);

    // Wait for the cleared-scope reload so stale rows and the skeleton never satisfy the checks.
    const clearedReload = page.waitForResponse(
      (response) =>
        response.url().includes('/documents/analytics') &&
        response.request().method() === 'GET',
    );
    await clearLegalEntities(page);
    await clearedReload;
    await expect
      .poll(async () => rows.count())
      .toBeGreaterThanOrEqual(scopedRowCount);
    await expect(fiveMonthRow).toHaveCount(1);

    // No query statistics leak anywhere on the page.
    const analyticsText = await page.locator('main').innerText();
    expect(analyticsText).not.toMatch(/quer(y|ies)/i);
    expect(analyticsText).not.toMatch(/\d+\s?ms\b/);

    await expectNoAccessibilityViolations(page);
    // The full page image is the human readable proof the demo command leaves behind.
    await page.screenshot({
      fullPage: true,
      path: 'test-results/documents-analytics.png',
    });
  });

  test('the documents list shows tiles, tabs, filters, sort and opens a document', async ({
    page,
  }) => {
    test.skip(password.length === 0, 'BAP_OPERATIONAL_PASSWORD is required.');
    test.setTimeout(120_000);

    await page.goto(
      `/documents?organization=${encodeURIComponent(organizationSlug)}`,
    );
    await expect(
      page.getByRole('heading', { level: 1, name: 'Documents' }),
    ).toBeVisible();
    const table = page.getByRole('table', { name: 'Registered documents' });

    // The count the status All tab carries between parentheses, or -1 with none yet.
    const allTabCount = async () => {
      const text = await page.getByRole('tab', { name: /^All \(/ }).innerText();
      const match = /\((\d+)\)/.exec(text);
      return match === null ? -1 : Number(match[1]);
    };

    // Scope to the seeded entity, then clear and confirm totals before re-scoping.
    await selectMultiSelectLegalEntities(page, [entityName]);
    await expect(table.locator('tbody tr').first()).toBeVisible();
    const scopedTabCount = await allTabCount();
    expect(scopedTabCount).toBeGreaterThanOrEqual(1);

    await clearLegalEntities(page);
    // Every entity in scope is a superset of the seeded one, so the total never drops.
    await expect.poll(allTabCount).toBeGreaterThanOrEqual(scopedTabCount);

    // Re-scope so the tiles, tabs and the opened row below belong to this run.
    await selectMultiSelectLegalEntities(page, [entityName]);
    await expect.poll(allTabCount).toBe(scopedTabCount);

    await test.step('the four stat tiles show numbers', async () => {
      const stats = page.getByRole('region', { name: 'Document statistics' });
      for (const label of [
        'Documents',
        'Needs review',
        'With issues',
        'Total shown',
      ]) {
        await expect(stats.getByText(label, { exact: true })).toBeVisible();
      }
      // Poll until the tiles settle past the defaulted loading counts.
      await expect
        .poll(async () => stats.locator('p').filter({ hasText: /\d/ }).count())
        .toBeGreaterThanOrEqual(4);
    });

    await test.step('the All tab count matches the rows it shows', async () => {
      // Match the "All (n)" tab by its count, not "All legal entities".
      const tabText = await page
        .getByRole('tab', { name: /^All \(/ })
        .innerText();
      const match = /\((\d+)\)/.exec(tabText);
      expect(match, 'The All tab carries no count.').not.toBeNull();
      const rows = await table.locator('tbody tr').count();
      expect(Number(match![1])).toBe(rows);
    });

    await test.step('Filter reveals the date pickers', async () => {
      await page.getByRole('button', { name: 'Filter' }).click();
      await expect(page.getByLabel('Document date from')).toBeVisible();
      await expect(page.getByLabel('Document date to')).toBeVisible();
      await page.getByRole('button', { name: 'Filter' }).click();
    });

    await test.step('the title, toolbar, grid container, table and footer share the page edges', async () => {
      // Measure only after the loading skeleton is gone.
      await expect(page.locator('.cds--pagination')).toBeVisible();
      const box = async (locator: Locator) => {
        const rect = await locator.boundingBox();
        expect(rect).not.toBeNull();
        return rect!;
      };
      const title = await box(
        page.getByRole('heading', { level: 1, name: 'Documents' }),
      );
      const toolbar = await box(page.locator('.cds--table-toolbar').first());
      const container = await box(page.locator('.cds--data-table-container'));
      const grid = await box(table);
      const footer = await box(page.locator('.cds--pagination').first());
      // Every row starts at the one left edge the page grid sets.
      for (const rect of [toolbar, container, grid, footer]) {
        expect(Math.abs(title.x - rect.x)).toBeLessThanOrEqual(1);
      }
      // The table body and the footer end where the grid container does.
      expect(
        Math.abs(container.x + container.width - (grid.x + grid.width)),
      ).toBeLessThanOrEqual(1);
      expect(
        Math.abs(container.x + container.width - (footer.x + footer.width)),
      ).toBeLessThanOrEqual(1);

      // The scope field and New document share one row, field on the left.
      const scopeField = await box(page.locator('.cds--multi-select').first());
      const primary = await box(
        page.getByRole('link', { name: 'New document' }),
      );
      const midY = (rect: { height: number; y: number }) =>
        rect.y + rect.height / 2;
      expect(Math.abs(midY(scopeField) - midY(primary))).toBeLessThanOrEqual(1);
      expect(scopeField.x + scopeField.width).toBeLessThanOrEqual(
        primary.x + 1,
      );
    });

    await test.step('a column sort changes the row order', async () => {
      const order = async () =>
        (await table.locator('tbody tr td:first-child').allInnerTexts()).join(
          '|',
        );
      const before = await order();
      await Promise.all([
        page.waitForResponse(
          (response) =>
            response.url().includes('/documents?') &&
            response.request().method() === 'GET',
        ),
        table.getByText('Total', { exact: true }).click(),
      ]);
      // Wait out the reload skeleton before comparing the settled order.
      await expect(page.locator('.cds--pagination')).toBeVisible();
      await expect(table.locator('tbody tr').first()).toBeVisible();
      await expect.poll(order).not.toBe(before);
    });

    await test.step('an invoice row opens on its Lines tab with a full-width header, summary tile and tabs', async () => {
      // An invoice kind is opened by name so the default tab is provably Lines.
      await table
        .locator('tbody tr')
        .filter({ hasText: fiveMonthReference })
        .first()
        .click();
      await expect(page).toHaveURL(/\/documents\/[^/?]+/);

      // Invoices open on Lines; every other kind opens on the Original tab.
      const linesTab = page.getByRole('tab', { name: /^Lines/ });
      await expect(linesTab).toHaveAttribute('aria-selected', 'true');

      const summaryHeading = page.getByRole('heading', {
        level: 2,
        name: 'Summary',
      });
      await expect(summaryHeading).toBeVisible();

      const box = async (locator: Locator) => {
        const rect = await locator.boundingBox();
        expect(rect).not.toBeNull();
        return rect!;
      };
      // The h1 is icon-indented, so its parent row carries the left edge.
      const title = await box(
        page.getByRole('heading', { level: 1 }).locator('xpath=..'),
      );
      // The one-line subtitle joins the kind, reference, date and partner with a middot.
      const subtitle = await box(
        page.locator('main p').filter({ hasText: '·' }).first(),
      );
      const summaryTile = await box(page.locator('.cds--tile').first());
      const tabs = await box(page.getByRole('tablist').first());
      // The header actions row's right edge is where the header ends.
      const actions = await box(
        page.getByRole('button', { name: 'Mark verified' }).locator('xpath=..'),
      );

      // The title, subtitle, summary tile and tabs all start at the page-grid left edge.
      for (const rect of [subtitle, summaryTile, tabs]) {
        expect(Math.abs(title.x - rect.x)).toBeLessThanOrEqual(1);
      }
      // The actions sit level at the right page edge, so the header never wraps.
      expect(
        Math.abs(
          actions.x + actions.width - (summaryTile.x + summaryTile.width),
        ),
      ).toBeLessThanOrEqual(1);
    });
  });
});
