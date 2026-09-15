import type { Page } from '@playwright/test';
import axe from 'axe-core';

import { expect, test } from './authenticated-test';
import { ensureLegalEntity } from './legal-entity-support';

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

type AxeWindow = Window &
  typeof globalThis & {
    axe: {
      run: (document: Document) => Promise<{
        violations: ReadonlyArray<{
          id: string;
          impact: string | null;
          nodes: ReadonlyArray<Readonly<{ target: ReadonlyArray<string> }>>;
        }>;
      }>;
    };
  };

type LegalEntityList = Readonly<{
  legalEntities: ReadonlyArray<Readonly<{ id: string; name: string }>>;
}>;

type PartnerList = Readonly<{
  partners: ReadonlyArray<Readonly<{ id: string; name: string }>>;
}>;

let legalEntityId = '';
let partnerId = '';

async function expectNoAccessibilityViolations(page: Page): Promise<void> {
  await page.evaluate(axe.source);
  const violations = await page.evaluate(async () => {
    const results = await (window as AxeWindow).axe.run(document);
    return results.violations.map(({ id, impact, nodes }) => ({
      id,
      impact,
      targets: nodes.map((node) => node.target),
    }));
  });
  expect(violations).toEqual([]);
}

// The entity is created through the real owner UI, then its identifier is read back from the register.
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
  const partner = (await created.json()) as Readonly<{ id: string }>;
  return partner.id;
}

async function registerDocument(
  page: Page,
  label: string,
  body: Readonly<Record<string, unknown>>,
): Promise<void> {
  const created = await page.request.post(documentsPath, { data: body });
  expect(created.status(), `${label} was refused.`).toBe(201);
}

// The analytics page may scope itself to one entity; the demo stack holds exactly one, so the select is optional.
async function selectAnalyticsLegalEntity(page: Page): Promise<void> {
  const selector = page.getByLabel('Legal entity', { exact: true });

  if ((await selector.count()) === 0) {
    return;
  }

  await expect(selector).toBeVisible();
  await selector.selectOption({ label: entityName });
}

test.describe.serial('document analytics read from the stored split', () => {
  test('owner seeds one entity, one partner and five demo documents', async ({
    page,
  }) => {
    test.skip(password.length === 0, 'BAP_OPERATIONAL_PASSWORD is required.');
    // Five registrations each derive an event, so the seed needs more than the shared budget.
    test.setTimeout(180_000);

    await ensureLegalEntity(page, organizationSlug, entityName);
    legalEntityId = await resolveLegalEntityId(page);
    partnerId = await ensurePartner(page);

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
    await selectAnalyticsLegalEntity(page);

    const documents = page.getByTestId('analytics-documents');
    await expect(documents).toBeVisible();
    // The contract carries no economic event, so this run adds four invoice rows; earlier runs may have left more.
    expect(await documents.locator('tbody tr').count()).toBeGreaterThanOrEqual(
      4,
    );

    const fiveMonthRow = documents
      .locator('tbody tr')
      .filter({ hasText: fiveMonthReference });
    await expect(fiveMonthRow).toHaveCount(1);
    await expect(fiveMonthRow).toContainText(amountDuePattern);

    const byMonth = page.getByTestId('analytics-by-month');
    await expect(byMonth).toBeVisible();
    for (const month of [
      '2026-01',
      '2026-02',
      '2026-03',
      '2026-04',
      '2026-05',
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

    // The page states its own cost, so the read is visibly a stored split rather than a recompute.
    await expect(page.getByTestId('analytics-stats')).toContainText(
      /\d+ event lines/,
    );

    await expectNoAccessibilityViolations(page);
    // The full page image is the human readable proof the demo command leaves behind.
    await page.screenshot({
      fullPage: true,
      path: 'test-results/documents-analytics.png',
    });
  });
});
