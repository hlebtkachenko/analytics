import { expect, test as publicTest } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import axe from 'axe-core';

import { expect as authenticatedExpect, test } from './authenticated-test';

const organizationId =
  process.env.BAP_OPERATIONAL_ORGANIZATION_ID ?? 'bap-operational';
const organizationSlug =
  process.env.BAP_OPERATIONAL_ORGANIZATION_SLUG ?? 'bap-operational';
const password = process.env.BAP_OPERATIONAL_PASSWORD ?? '';

const fixture = `${[
  'label,value',
  ...Array.from(
    { length: 30 },
    (_, index) => `row-${String(index + 1)},${String(index + 1)}`,
  ),
].join('\n')}\n`;
const fixtureName = `operational-icons-${Date.now()}.csv`;

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

type DatasetList = Readonly<{
  datasets: ReadonlyArray<Readonly<{ name: string; status: string }>>;
}>;

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

async function expectNoDocumentOverflow(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
}

async function expectIconControl(
  control: Locator,
  accessibleName: string,
): Promise<void> {
  await expect(control).toBeVisible();
  await expect(control).toHaveAccessibleName(accessibleName);
  const visibleLabel = (await control.innerText())
    .replaceAll(/\s+/g, ' ')
    .trim();
  expect(visibleLabel).not.toBe('');
  expect(accessibleName.toLowerCase()).toContain(visibleLabel.toLowerCase());

  const icon = control.locator('svg.cds--btn__icon');
  await expect(icon).toHaveCount(1);
  await expect(icon).toHaveAttribute('aria-hidden', 'true');
  await expect(icon).toHaveAttribute('fill', 'currentColor');
  await expect(icon).toHaveAttribute('height', '16');
  await expect(icon).toHaveAttribute('width', '16');
  await expect(icon).not.toHaveAttribute('aria-label', /.+/);
  await expect(icon).not.toHaveAttribute('focusable', 'true');
  await expect(icon).not.toHaveAttribute('tabindex', /.+/);

  const geometry = await control.evaluate((element) => {
    const glyph = element.querySelector<SVGElement>('svg.cds--btn__icon');
    if (!glyph) {
      throw new Error('Icon glyph is missing.');
    }
    const controlRect = element.getBoundingClientRect();
    const iconRect = glyph.getBoundingClientRect();
    return {
      controlHeight: controlRect.height,
      controlWidth: controlRect.width,
      iconHeight: iconRect.height,
      iconTabIndex: glyph.tabIndex,
      iconWidth: iconRect.width,
      verticalOffset: Math.abs(
        controlRect.top +
          controlRect.height / 2 -
          (iconRect.top + iconRect.height / 2),
      ),
    };
  });
  expect(geometry.controlHeight).toBeGreaterThanOrEqual(44);
  expect(geometry.controlWidth).toBeGreaterThanOrEqual(44);
  expect(geometry.iconHeight).toBe(16);
  expect(geometry.iconWidth).toBe(16);
  expect(geometry.iconTabIndex).toBe(-1);
  expect(geometry.verticalOffset).toBeLessThanOrEqual(1);
  expect(
    await icon.evaluate((element) => element === document.activeElement),
  ).toBe(false);
}

async function expectDecorativeStatusIcon(heading: Locator): Promise<void> {
  const icon = heading.locator('..').locator('svg');
  await expect(icon).toHaveCount(1);
  await expect(icon).toHaveAttribute('aria-hidden', 'true');
  await expect(icon).toHaveAttribute('focusable', 'false');
  await expect(icon).toHaveAttribute('fill', 'currentColor');
  await expect(icon).toHaveAttribute('height', '20');
  await expect(icon).toHaveAttribute('width', '20');
  await expect(icon).not.toHaveAttribute('aria-label', /.+/);
  await expect(icon).not.toHaveAttribute('tabindex', /.+/);
  expect(
    await icon.evaluate((element) => {
      const rectangle = element.getBoundingClientRect();
      return {
        active: element === document.activeElement,
        height: rectangle.height,
        tabIndex: element.tabIndex,
        width: rectangle.width,
      };
    }),
  ).toEqual({ active: false, height: 20, tabIndex: -1, width: 20 });
}

async function focusWithKeyboard(page: Page, control: Locator): Promise<void> {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });

  for (let index = 0; index < 20; index += 1) {
    await page.keyboard.press('Tab');
    if (
      await control.evaluate((element) => element === document.activeElement)
    ) {
      return;
    }
  }

  throw new Error('Keyboard navigation did not reach the icon control.');
}

function monitorPage(page: Page): Readonly<{
  consoleErrors: string[];
  pageErrors: string[];
}> {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  return { consoleErrors, pageErrors };
}

publicTest(
  'proves real public Carbon icon controls and 640px layout-equivalent reflow',
  async ({ page }) => {
    publicTest.setTimeout(60_000);
    const errors = monitorPage(page);
    await page.setViewportSize({ height: 900, width: 640 });

    await page.goto('/sign-in');
    const signInButton = page.getByRole('button', { name: 'Sign in' });
    await expectIconControl(signInButton, 'Sign in');
    await focusWithKeyboard(page, signInButton);
    await expectNoAccessibilityViolations(page);
    await expectNoDocumentOverflow(page);

    await page.goto('/forgot-password');
    await expectIconControl(
      page.getByRole('button', { name: 'Send reset link' }),
      'Send reset link',
    );

    await page.goto('/sign-in/two-factor');
    await expectIconControl(
      page.getByRole('button', { name: 'Verify' }),
      'Verify',
    );

    await page.goto('/reset-password?token=ResetSentinelTokenAbc123');
    await expect(page).toHaveURL(/\/reset-password$/);
    await expectIconControl(
      page.getByRole('button', { name: 'Update password' }),
      'Update password',
    );

    await page.goto('/design-system');
    await expectIconControl(
      page.getByRole('link', { name: 'Open Carbon React documentation' }),
      'Open Carbon React documentation',
    );

    await page.goto('/sign-up');
    await expectIconControl(
      page.getByRole('button', { name: 'Create account' }),
      'Create account',
    );

    await expectNoAccessibilityViolations(page);
    await expectNoDocumentOverflow(page);
    expect(errors.consoleErrors).toEqual([]);
    expect(errors.pageErrors).toEqual([]);
  },
);

test('proves every real authenticated icon control and Phase 10 exclusion', async ({
  page,
}) => {
  test.skip(password.length === 0, 'BAP_OPERATIONAL_PASSWORD is required.');
  test.setTimeout(90_000);
  const errors = monitorPage(page);
  await page.setViewportSize({ height: 900, width: 640 });

  const accessReady = Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === 'GET' &&
        new URL(response.url()).pathname ===
          `/api/bff/application/organizations/${organizationId}/access`,
    ),
    page.waitForResponse(
      (response) =>
        response.request().method() === 'GET' &&
        new URL(response.url()).pathname ===
          `/api/bff/reporting/organizations/${organizationId}/access`,
    ),
  ]);
  await page.goto('/access');
  for (const response of await accessReady) {
    authenticatedExpect(response.ok()).toBe(true);
  }
  const organization = page.getByLabel('Organization');
  await authenticatedExpect(organization).toBeVisible();
  await authenticatedExpect(organization).toHaveValue(organizationId);
  await authenticatedExpect(
    page.getByText('Application API role: owner'),
  ).toBeVisible();

  for (const [role, label] of [
    ['button', 'Sign out'],
    ['link', 'Open datasets'],
    ['link', 'Manage members'],
    ['link', 'Upload data'],
  ] as const) {
    await expectIconControl(page.getByRole(role, { name: label }), label);
  }
  for (const label of ['Manage data grants', 'Ask the assistant']) {
    const heading = page.getByRole('heading', { name: label });
    await authenticatedExpect(heading).toBeVisible();
    await expectDecorativeStatusIcon(heading);
    await authenticatedExpect(
      page.getByRole('button', { name: label }),
    ).toHaveCount(0);
    await authenticatedExpect(
      page.getByRole('link', { name: label }),
    ).toHaveCount(0);
  }
  await focusWithKeyboard(page, page.getByRole('button', { name: 'Sign out' }));
  await expectNoAccessibilityViolations(page);
  await expectNoDocumentOverflow(page);

  const datasetsReady = Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === 'GET' &&
        new URL(response.url()).pathname ===
          `/api/bff/application/organizations/${organizationId}/access`,
    ),
    page.waitForResponse(
      (response) =>
        response.request().method() === 'GET' &&
        new URL(response.url()).pathname ===
          `/api/bff/application/organizations/${organizationId}/datasets`,
    ),
  ]);
  await page.goto('/datasets');
  for (const response of await datasetsReady) {
    authenticatedExpect(response.ok()).toBe(true);
  }
  const datasetOrganization = page.getByLabel('Organization');
  await authenticatedExpect(datasetOrganization).toBeVisible();
  await authenticatedExpect(datasetOrganization).toHaveValue(organizationId);
  const chooser = page.locator('input[name="file"]');
  await authenticatedExpect(chooser).toBeAttached();
  await chooser.setInputFiles({
    buffer: Buffer.from(fixture, 'utf8'),
    mimeType: 'text/csv',
    name: fixtureName,
  });
  const uploadButton = page.getByRole('button', { name: 'Upload data' });
  await expectIconControl(uploadButton, 'Upload data');
  const uploaded = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().includes(`/organizations/${organizationId}/uploads`),
  );
  await uploadButton.click();
  expect((await uploaded).status()).toBe(202);

  await authenticatedExpect
    .poll(
      async () => {
        const listed = await page.request.get(
          `/api/bff/application/organizations/${organizationId}/datasets`,
        );
        if (!listed.ok()) {
          return `http_${listed.status()}`;
        }
        const body = (await listed.json()) as DatasetList;
        return (
          body.datasets.find((dataset) => dataset.name === fixtureName)
            ?.status ?? 'absent'
        );
      },
      { intervals: [1_000], timeout: 30_000 },
    )
    .toBe('ready');

  await page.reload();
  const row = page.getByRole('row').filter({ hasText: fixtureName });
  const open = row.getByRole('button', { name: `Open ${fixtureName}` });
  await expectIconControl(open, `Open ${fixtureName}`);
  await open.click();
  await authenticatedExpect(
    page.getByRole('table', { name: 'Dataset rows' }),
  ).toBeVisible();

  for (const label of [
    'Close dataset',
    'Previous page',
    'Next page',
    'Download CSV',
    'Download XLSX',
    'Send',
  ]) {
    await expectIconControl(page.getByRole('button', { name: label }), label);
  }
  await page.getByRole('button', { name: 'Next page' }).click();
  await authenticatedExpect(page.getByText('Page 2')).toBeVisible();
  await page.getByRole('button', { name: 'Previous page' }).click();
  await authenticatedExpect(page.getByText('Page 1')).toBeVisible();
  await expectNoAccessibilityViolations(page);
  await expectNoDocumentOverflow(page);

  for (const route of [
    '/organizations',
    '/organizations/new',
    `/${organizationSlug}`,
    `/${organizationSlug}/members`,
    `/${organizationSlug}/settings`,
  ]) {
    await page.goto(route);
    await authenticatedExpect(page.locator('main')).toHaveCount(1);
    const temporaryContent = page.locator('main');
    await authenticatedExpect(
      temporaryContent.locator('svg.cds--btn__icon'),
    ).toHaveCount(0);
    await authenticatedExpect(
      temporaryContent.locator('[class*="cds--"]'),
    ).toHaveCount(0);
    await expectNoAccessibilityViolations(page);
    await expectNoDocumentOverflow(page);
  }

  await page.setViewportSize({ height: 640, width: 320 });
  await page.goto('/access');
  await expectNoDocumentOverflow(page);
  await page.getByRole('button', { name: 'Open primary navigation' }).click();
  const smallScreenAccount = page
    .getByRole('navigation', {
      exact: true,
      name: 'Primary navigation on small screens',
    })
    .getByRole('link', { name: 'Account' });
  await focusWithKeyboard(page, smallScreenAccount);
  await page.keyboard.press('Enter');
  await authenticatedExpect(page).toHaveURL(/\/account$/);
  await authenticatedExpect(
    page.getByRole('heading', { exact: true, name: 'Account' }),
  ).toBeVisible();
  await authenticatedExpect(page.locator('main')).toHaveCount(1);
  await expectNoDocumentOverflow(page);
  await expectNoAccessibilityViolations(page);

  expect(errors.consoleErrors).toEqual([]);
  expect(errors.pageErrors).toEqual([]);
});
