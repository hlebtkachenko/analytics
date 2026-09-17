import { expect, test as publicTest } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

import { expectNoAccessibilityViolations } from './accessibility-support';
import { expect as authenticatedExpect, test } from './authenticated-test';
import {
  ensureLegalEntity,
  selectUploadLegalEntity,
} from './legal-entity-support';

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
// Neutral placeholder: every upload belongs to exactly one legal entity.
const legalEntityName = 'Placeholder Icons';

type DatasetList = Readonly<{
  datasets: ReadonlyArray<Readonly<{ name: string; status: string }>>;
}>;

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

// Carbon animates the header panel open, so axe must scan it settled. Wait by
// geometry, not the internal expanded class or its fixed width: poll a public
// element inside the panel until two reads 100ms apart are equal and non-zero.
async function expectSettledHeaderPanel(panelContent: Locator): Promise<void> {
  await expect(panelContent).toBeVisible();
  const page = panelContent.page();
  await expect
    .poll(
      async () => {
        const first = await panelContent.boundingBox();
        await page.waitForTimeout(100);
        const second = await panelContent.boundingBox();
        return (
          first !== null &&
          second !== null &&
          second.width > 0 &&
          second.height > 0 &&
          second.x === first.x &&
          second.y === first.y &&
          second.width === first.width &&
          second.height === first.height
        );
      },
      { timeout: 5_000 },
    )
    .toBe(true);
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

test('proves every real authenticated icon control and header panel', async ({
  page,
}) => {
  test.skip(password.length === 0, 'BAP_OPERATIONAL_PASSWORD is required.');
  test.setTimeout(90_000);
  const errors = monitorPage(page);
  await page.setViewportSize({ height: 900, width: 640 });
  await ensureLegalEntity(page, organizationSlug, legalEntityName);

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
  await page.goto('/account/access');
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
    ['link', 'Manage entity access'],
    ['link', 'Manage legal entities'],
    ['link', 'Upload data'],
    ['link', 'Ask the assistant'],
  ] as const) {
    await expectIconControl(page.getByRole(role, { name: label }), label);
  }
  // The assistant action is a real link into the workspace datasets, no placeholder tile.
  await authenticatedExpect(
    page.getByRole('link', { name: 'Ask the assistant' }),
  ).toHaveAttribute('href', `/datasets?organization=${organizationSlug}`);
  for (const capability of [
    'Manage organization',
    'Manage members',
    'Manage entity access',
    'Create legal entities',
    'Edit legal entities',
    'Delete legal entities',
    'Upload data',
    'Read documents',
    'Manage documents',
    'Ask the assistant',
  ]) {
    await authenticatedExpect(
      page.getByText(`${capability}: Allowed`),
    ).toBeVisible();
  }
  await authenticatedExpect(
    page.getByText('Entity scope: All legal entities'),
  ).toBeVisible();
  await focusWithKeyboard(page, page.getByRole('button', { name: 'Sign out' }));
  await expectNoAccessibilityViolations(page);
  await expectNoDocumentOverflow(page);

  // The header holds exactly four global actions: search, help, account, and
  // the workspace switcher; every panel renders real content at 640px.
  const header = page.getByRole('banner');
  await authenticatedExpect(
    header.getByRole('button', { name: /^(Search|Help|Account|Workspaces)$/ }),
  ).toHaveCount(4);
  await authenticatedExpect(
    header.getByRole('button', { name: /^(Notifications|Settings)$/ }),
  ).toHaveCount(0);

  await header.getByRole('button', { exact: true, name: 'Help' }).click();
  await authenticatedExpect(
    header.getByRole('button', { exact: true, name: 'Help' }),
  ).toHaveAttribute('aria-expanded', 'true');
  await authenticatedExpect(
    header.getByRole('link', { name: 'Documentation' }),
  ).toHaveAttribute('href', /\/docs$/);
  await authenticatedExpect(
    header.getByText(/^Version \d+\.\d+\.\d+$/),
  ).toBeVisible();
  await expectSettledHeaderPanel(
    header.getByRole('link', { name: 'Documentation' }),
  );
  await expectNoAccessibilityViolations(page);
  await expectNoDocumentOverflow(page);

  await header.getByRole('button', { exact: true, name: 'Account' }).click();
  await authenticatedExpect(
    header.getByRole('button', { exact: true, name: 'Help' }),
  ).toHaveAttribute('aria-expanded', 'false');
  await authenticatedExpect(
    header.getByText('Operational Owner'),
  ).toBeVisible();
  await authenticatedExpect(
    header.getByRole('link', { name: 'Security and sessions' }),
  ).toHaveAttribute('href', '/account/security');
  await authenticatedExpect(
    header.getByRole('radio', { name: 'System' }),
  ).toBeChecked();
  await authenticatedExpect(
    header.getByRole('button', { name: 'Sign out' }),
  ).toBeVisible();
  await expectSettledHeaderPanel(
    header.getByRole('button', { name: 'Sign out' }),
  );
  await expectNoAccessibilityViolations(page);
  await expectNoDocumentOverflow(page);

  await header.getByRole('button', { exact: true, name: 'Workspaces' }).click();
  const switcherWorkspace = header
    .getByRole('list', { name: 'Workspaces' })
    .getByRole('link', { name: 'BAP Operational' });
  await authenticatedExpect(switcherWorkspace).toHaveAttribute(
    'href',
    `/${organizationSlug}`,
  );
  await authenticatedExpect(
    header.getByRole('link', { name: 'Manage workspaces' }),
  ).toHaveAttribute('href', '/organizations');
  // Every switcher item is a real keyboard destination.
  await focusWithKeyboard(page, switcherWorkspace);
  await expectSettledHeaderPanel(switcherWorkspace);
  await expectNoAccessibilityViolations(page);
  await expectNoDocumentOverflow(page);

  await header.getByRole('button', { exact: true, name: 'Search' }).click();
  const searchBox = header.getByRole('searchbox', { name: 'Search' });
  await authenticatedExpect(searchBox).toBeFocused();
  await authenticatedExpect(
    header.getByRole('button', { exact: true, name: 'Close search' }),
  ).toHaveAttribute('aria-expanded', 'true');
  const results = header.getByRole('listbox', { name: 'Search' });
  await authenticatedExpect(
    results.getByRole('option', { name: 'Workspaces' }),
  ).toHaveAttribute('aria-selected', 'true');
  await searchBox.fill('acc');
  await authenticatedExpect(results.getByRole('option')).toHaveCount(1);
  await authenticatedExpect(
    results.getByRole('option', { name: 'Account' }),
  ).toHaveAttribute('aria-selected', 'true');
  await expectNoAccessibilityViolations(page);
  await expectNoDocumentOverflow(page);
  await page.keyboard.press('Escape');
  await authenticatedExpect(searchBox).toHaveCount(0);
  await authenticatedExpect(
    header.getByRole('button', { exact: true, name: 'Search' }),
  ).toHaveAttribute('aria-expanded', 'false');
  await header.getByRole('button', { exact: true, name: 'Search' }).click();
  await searchBox.fill('account');
  await page.keyboard.press('Enter');
  await authenticatedExpect(page).toHaveURL(/\/account$/);
  await authenticatedExpect(
    page.getByRole('heading', { exact: true, name: 'Account' }),
  ).toBeVisible();
  await authenticatedExpect(searchBox).toHaveCount(0);

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
  await selectUploadLegalEntity(page, legalEntityName);
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
      // A widening interval keeps the owner well inside the 60-per-minute subject rule.
      { intervals: [1_000, 2_000, 3_000], timeout: 45_000 },
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

  // The workspace landing page is Carbon: the heading is the workspace name
  // and every tile is a real link; locators stay inside main so the rail's
  // module links never collide with the tiles.
  await page.goto(`/${organizationSlug}`);
  const landing = page.getByRole('main');
  await authenticatedExpect(landing).toHaveCount(1);
  await authenticatedExpect(
    landing.getByRole('heading', { exact: true, name: 'BAP Operational' }),
  ).toBeVisible();
  await authenticatedExpect(
    landing.getByText('Some workspace details could not be loaded.'),
  ).toHaveCount(0);
  for (const [name, href] of [
    [/^Members [1-9]\d* of 100$/, `/${organizationSlug}/members`],
    [
      /^Pending invitations \d+$/,
      `/${organizationSlug}/members?tab=invitations`,
    ],
    [/^Legal entities [1-9]\d*$/, `/${organizationSlug}/entities`],
    ['Documents', '/documents'],
    ['Datasets', '/datasets'],
    ['Settings', `/${organizationSlug}/settings`],
  ] as const) {
    const tile = landing.getByRole('link', { exact: true, name });
    await authenticatedExpect(tile).toBeVisible();
    await authenticatedExpect(tile).toHaveAttribute('href', href);
  }
  await expectNoAccessibilityViolations(page);
  await expectNoDocumentOverflow(page);

  await page.setViewportSize({ height: 640, width: 320 });
  await page.goto('/account/access');
  await expectNoDocumentOverflow(page);
  await page.getByRole('button', { name: 'Expand side navigation' }).click();
  const smallScreenAccount = page
    .getByRole('navigation', {
      exact: true,
      name: 'Side navigation',
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

  await page.goto('/account/security');
  await expectNoDocumentOverflow(page);
  await expectNoAccessibilityViolations(page);

  expect(errors.consoleErrors).toEqual([]);
  expect(errors.pageErrors).toEqual([]);
});
