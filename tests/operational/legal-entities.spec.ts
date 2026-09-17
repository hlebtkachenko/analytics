import type { Browser, BrowserContext, Locator, Page } from '@playwright/test';

import { expectNoAccessibilityViolations } from './accessibility-support';
import { expect, test } from './authenticated-test';
import { selectUploadLegalEntity } from './legal-entity-support';
import { rateLimitDelayMs, signInThroughForm } from './sign-in';

const adminEmail =
  process.env.BAP_OPERATIONAL_ADMIN_EMAIL ?? 'admin@bap.invalid';
const baseURL =
  process.env.BAP_OPERATIONAL_BASE_URL ?? 'http://localhost:39100';
const memberEmail =
  process.env.BAP_OPERATIONAL_MEMBER_EMAIL ?? 'member@bap.invalid';
const organizationId =
  process.env.BAP_OPERATIONAL_ORGANIZATION_ID ?? 'bap-operational';
const organizationSlug =
  process.env.BAP_OPERATIONAL_ORGANIZATION_SLUG ?? 'bap-operational';
const password = process.env.BAP_OPERATIONAL_PASSWORD ?? '';

// Neutral placeholders: this repository never carries real company data.
const companyName = 'Placeholder Company';
const soleTraderName = 'Placeholder Sole Trader';
const adminEntityName = 'Placeholder Branch';
const allEntitiesLabel = 'All legal entities';
const companyRegistration = 'PLACEHOLDER-1';

// A synthetic fixture with no meaning: one text column, one numeric column, three rows.
const fixture = `${['label,value', 'alpha,10', 'beta,20', 'gamma,30'].join('\n')}\n`;
const fixtureName = `operational-entities-${Date.now()}.csv`;

type DatasetList = Readonly<{
  datasets: ReadonlyArray<Readonly<{ name: string; status: string }>>;
}>;

let adminContext: BrowserContext | undefined;
let memberContext: BrowserContext | undefined;

const datasetsPathname = `/api/bff/application/organizations/${organizationId}/datasets`;

async function signInContext(
  browser: Browser,
  email: string,
): Promise<BrowserContext> {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();

  try {
    await signInThroughForm(page, email, password);
  } catch (error) {
    await context.close();
    throw error;
  }

  await page.close();
  return context;
}

// A denied request costs no budget, so a rate-limited switch is simply driven again.
async function selectDatasetScope(
  page: Page,
  scope: Locator,
  label: string,
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const pending = page.waitForResponse(
      (response) =>
        response.request().method() === 'GET' &&
        new URL(response.url()).pathname === datasetsPathname,
    );
    await scope.selectOption({ label });
    const response = await pending;

    if (response.ok()) {
      return;
    }

    if (response.status() !== 429) {
      throw new Error(`Dataset scope failed with ${response.status()}.`);
    }

    // Repeating one value would not refetch, so the retry leaves it before waiting out the window.
    await scope.selectOption({
      label: label === allEntitiesLabel ? companyName : allEntitiesLabel,
    });
    await page.waitForTimeout(
      rateLimitDelayMs(response.headers()['retry-after']),
    );
  }

  throw new Error('Dataset scope stayed rate limited.');
}

async function useSignedInPage(
  browser: Browser,
  email: string,
  run: (page: Page) => Promise<void>,
): Promise<void> {
  const context =
    email === adminEmail
      ? (adminContext ??= await signInContext(browser, email))
      : (memberContext ??= await signInContext(browser, email));
  const page = await context.newPage();

  try {
    await run(page);
  } finally {
    await page.close();
  }
}

// A legal entity is a DataGrid row identified by its unique name.
function entityRow(page: Page, name: string): Locator {
  return page.getByRole('row').filter({ hasText: name });
}

// Drives the Carbon create modal end to end and waits for the success toast.
async function createLegalEntity(
  page: Page,
  values: Readonly<{ kind: string; name: string; registration?: string }>,
): Promise<void> {
  await page.getByRole('button', { name: 'Add legal entity' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add legal entity' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Name').fill(values.name);
  await dialog.getByLabel('Kind').selectOption(values.kind);
  if (values.registration !== undefined) {
    await dialog.getByLabel('Registration number').fill(values.registration);
  }
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('The legal entity was created.')).toBeVisible();
  await expect(dialog).toBeHidden();
}

test.afterAll(async () => {
  await adminContext?.close();
  await memberContext?.close();
  adminContext = undefined;
  memberContext = undefined;
});

test.describe.serial('workspace legal entities and entity scope', () => {
  test('owner creates two legal entities in the workspace', async ({
    page,
  }) => {
    test.skip(password.length === 0, 'BAP_OPERATIONAL_PASSWORD is required.');

    await page.goto(`/${organizationSlug}/entities`);
    await expect(
      page.getByRole('heading', { name: 'BAP Operational legal entities' }),
    ).toBeVisible();

    await createLegalEntity(page, {
      kind: 'company',
      name: companyName,
      registration: companyRegistration,
    });
    const companyRow = entityRow(page, companyName);
    await expect(
      companyRow.getByRole('cell', { exact: true, name: companyName }),
    ).toBeVisible();
    await expect(
      companyRow.getByRole('cell', { exact: true, name: 'Company' }),
    ).toBeVisible();
    await expect(
      companyRow.getByRole('cell', { exact: true, name: companyRegistration }),
    ).toBeVisible();

    await createLegalEntity(page, {
      kind: 'sole_trader',
      name: soleTraderName,
    });
    const soleTraderRow = entityRow(page, soleTraderName);
    await expect(
      soleTraderRow.getByRole('cell', { exact: true, name: soleTraderName }),
    ).toBeVisible();
    await expect(
      soleTraderRow.getByRole('cell', { exact: true, name: 'Sole trader' }),
    ).toBeVisible();

    // The owner is offered the delete control in the row overflow menu.
    await companyRow.getByRole('button', { name: 'Options' }).click();
    await expect(page.getByRole('menuitem', { name: 'Delete' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expectNoAccessibilityViolations(page);
  });

  test('owner restricts the member to the first legal entity', async ({
    page,
  }) => {
    test.skip(password.length === 0, 'BAP_OPERATIONAL_PASSWORD is required.');

    await page.goto(`/${organizationSlug}/members`);
    const scopeEditor = page.getByRole('form', {
      name: `Entity access for ${memberEmail}`,
    });
    await expect(scopeEditor).toBeVisible();
    await scopeEditor.getByLabel('Selected entities').check();
    await scopeEditor.getByLabel(companyName, { exact: true }).check();
    await scopeEditor
      .getByRole('button', { name: 'Save entity access' })
      .click();
    await expect(page).toHaveURL(/\/members\?result=success$/);

    const stored = page.getByRole('form', {
      name: `Entity access for ${memberEmail}`,
    });
    await expect(stored.getByLabel('Selected entities')).toBeChecked();
    await expect(stored.getByLabel(companyName, { exact: true })).toBeChecked();
    await expect(
      stored.getByLabel(soleTraderName, { exact: true }),
    ).not.toBeChecked();
    await expectNoAccessibilityViolations(page);
  });

  test('admin creates a third legal entity and is offered no delete control', async ({
    browser,
  }) => {
    test.skip(password.length === 0, 'BAP_OPERATIONAL_PASSWORD is required.');
    // A fresh sign-in may have to wait out the shared 3-per-minute sign-in rule.
    test.setTimeout(150_000);

    await useSignedInPage(browser, adminEmail, async (page) => {
      await page.goto(`/${organizationSlug}/entities`);
      await expect(
        page.getByRole('button', { name: 'Add legal entity' }),
      ).toBeVisible();
      await createLegalEntity(page, {
        kind: 'company',
        name: adminEntityName,
      });
      const row = entityRow(page, adminEntityName);
      await expect(
        row.getByRole('cell', { exact: true, name: adminEntityName }),
      ).toBeVisible();
      await expect(
        row.getByRole('cell', { exact: true, name: 'Company' }),
      ).toBeVisible();

      // The admin may edit but is offered no delete control.
      await row.getByRole('button', { name: 'Options' }).click();
      await expect(page.getByRole('menuitem', { name: 'Edit' })).toBeVisible();
      await expect(page.getByRole('menuitem', { name: 'Delete' })).toHaveCount(
        0,
      );
      await page.keyboard.press('Escape');
      await expectNoAccessibilityViolations(page);
    });
  });

  test('member sees read-only capabilities and the restricted entity scope', async ({
    browser,
  }) => {
    test.skip(password.length === 0, 'BAP_OPERATIONAL_PASSWORD is required.');
    test.setTimeout(150_000);

    await useSignedInPage(browser, memberEmail, async (page) => {
      await page.goto('/access');
      await expect(
        page.getByText('Application API role: member'),
      ).toBeVisible();
      await expect(page.getByText('Reporting API role: member')).toBeVisible();

      for (const capability of [
        'Manage organization',
        'Manage members',
        'Manage entity access',
        'Create legal entities',
        'Edit legal entities',
        'Delete legal entities',
        'Upload data',
      ]) {
        await expect(
          page.getByText(`${capability}: Not allowed`),
        ).toBeVisible();
      }
      await expect(page.getByText('Ask the assistant: Allowed')).toBeVisible();
      await expect(
        page.getByText('Entity scope: Selected legal entities: 1'),
      ).toBeVisible();
      await expect(page.getByRole('link', { name: 'Upload data' })).toHaveCount(
        0,
      );
      await expect(
        page.getByRole('link', { name: 'Manage members' }),
      ).toHaveCount(0);
      await expect(
        page.getByRole('link', { name: 'Manage legal entities' }),
      ).toHaveCount(0);
      await expectNoAccessibilityViolations(page);
    });
  });

  test('member sees only the permitted legal entity in the dataset scope', async ({
    browser,
  }) => {
    test.skip(password.length === 0, 'BAP_OPERATIONAL_PASSWORD is required.');

    await useSignedInPage(browser, memberEmail, async (page) => {
      await page.goto('/datasets');
      await expect(
        page.getByRole('heading', { exact: true, name: 'Datasets' }),
      ).toBeVisible();
      const scope = page.getByLabel('Legal entity scope');
      await expect(scope.locator('option')).toHaveText([
        'All legal entities',
        companyName,
      ]);
      await expect(page.locator('#upload-dataset')).toHaveCount(0);
      await expect(page.locator('input[name="file"]')).toHaveCount(0);
      await expectNoAccessibilityViolations(page);
    });
  });

  test('owner uploads a dataset into the first legal entity and filters by it', async ({
    page,
  }) => {
    test.skip(password.length === 0, 'BAP_OPERATIONAL_PASSWORD is required.');
    // Ingestion runs on a polled queue, so this step needs more than the shared budget.
    test.setTimeout(120_000);

    await page.goto('/datasets');
    const organizations = page.getByLabel('Organization');
    await expect(organizations).toBeVisible();
    // The owner may hold more than one organization by now, so the proof selects its own.
    if ((await organizations.inputValue()) !== organizationId) {
      await organizations.selectOption(organizationId);
    }
    await expect(organizations).toHaveValue(organizationId);
    await selectUploadLegalEntity(page, companyName);
    await page.locator('input[name="file"]').setInputFiles({
      buffer: Buffer.from(fixture, 'utf8'),
      mimeType: 'text/csv',
      name: fixtureName,
    });
    const uploaded = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().includes(`/organizations/${organizationId}/uploads`),
    );
    await page.getByRole('button', { name: 'Upload data' }).click();
    expect((await uploaded).status()).toBe(202);

    // The upload response only means accepted, so the ready status the worker writes is the real condition.
    await expect
      .poll(
        async () => {
          const listed = await page.request.get(datasetsPathname);

          if (!listed.ok()) {
            return `http_${listed.status()}`;
          }

          const body = (await listed.json()) as DatasetList;
          return (
            body.datasets.find((dataset) => dataset.name === fixtureName)
              ?.status ?? 'absent'
          );
        },
        // A widening interval keeps the owner well inside the 60-per-minute subject rule.
        { intervals: [1_000, 2_000, 3_000], timeout: 60_000 },
      )
      .toBe('ready');

    // The switch itself refreshes the list, so no extra page load is spent on the ready row.
    const scope = page.getByLabel('Legal entity scope');
    const listedRow = page.getByRole('row').filter({ hasText: fixtureName });
    await selectDatasetScope(page, scope, companyName);
    await expect(listedRow).toHaveCount(1);
    await expect(
      listedRow.getByRole('cell', { exact: true, name: companyName }),
    ).toBeVisible();
    await expect(
      listedRow.getByRole('cell', { exact: true, name: 'Ready' }),
    ).toBeVisible();
    await selectDatasetScope(page, scope, soleTraderName);
    await expect(listedRow).toHaveCount(0);
    await selectDatasetScope(page, scope, allEntitiesLabel);
    await expect(listedRow).toHaveCount(1);
  });

  test('owner deletes the third legal entity', async ({ page }) => {
    test.skip(password.length === 0, 'BAP_OPERATIONAL_PASSWORD is required.');

    await page.goto(`/${organizationSlug}/entities`);
    await expect(entityRow(page, adminEntityName)).toHaveCount(1);
    await entityRow(page, adminEntityName)
      .getByRole('button', { name: 'Options' })
      .click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    const dialog = page.getByRole('dialog', {
      name: `Delete ${adminEntityName}`,
    });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Delete legal entity' }).click();
    await expect(page.getByText('The legal entity was deleted.')).toBeVisible();
    await expect(entityRow(page, adminEntityName)).toHaveCount(0);
    await expect(entityRow(page, companyName)).toHaveCount(1);
    await expect(entityRow(page, soleTraderName)).toHaveCount(1);
  });
});
