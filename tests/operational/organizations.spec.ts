import { normalizeOrganizationSlug } from '../../apps/web/src/lib/organizations/slug';
import { expectNoAccessibilityViolations } from './accessibility-support';
import { expect, test } from './authenticated-test';

const password = process.env.BAP_OPERATIONAL_PASSWORD ?? '';

async function expectNoHorizontalOverflow(
  page: import('@playwright/test').Page,
) {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
}

async function focusWithKeyboard(
  page: import('@playwright/test').Page,
  target: import('@playwright/test').Locator,
) {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });

  for (let index = 0; index < 30; index += 1) {
    await page.keyboard.press('Tab');
    if (
      await target.evaluate((element) => element === document.activeElement)
    ) {
      return;
    }
  }
  throw new Error('Keyboard navigation did not reach the requested control.');
}

test('walks the Carbon workspace loop through explicit member-scoped actions', async ({
  page,
}) => {
  test.skip(password.length === 0, 'BAP_OPERATIONAL_PASSWORD is required.');
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/organizations');
  await expect(page.getByRole('heading', { name: 'Workspaces' })).toBeVisible();
  // The seeded workspace is a Carbon DataGrid row, not a link.
  await expect(
    page.getByRole('cell', { name: 'BAP Operational' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page).toHaveURL(/\/organizations\/new$/);
  await expect(page.getByText('Remaining of granted quota: 1')).toBeVisible();

  let breadcrumbWorkspaces = page
    .getByRole('navigation', { name: 'Breadcrumb' })
    .getByRole('link', { name: 'Workspaces' });
  await focusWithKeyboard(page, breadcrumbWorkspaces);
  await expect(breadcrumbWorkspaces).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/organizations$/);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  breadcrumbWorkspaces = page
    .getByRole('navigation', { name: 'Breadcrumb' })
    .getByRole('link', { name: 'Workspaces' });
  await focusWithKeyboard(page, breadcrumbWorkspaces);
  const nameInput = page.getByLabel('Name');
  await focusWithKeyboard(page, nameInput);
  await expect(nameInput).toBeFocused();
  const uniqueName = `Phase ${Date.now().toString(36)}`;
  const createdSlug = normalizeOrganizationSlug(uniqueName);
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type(uniqueName);
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Slug')).toBeFocused();
  await expect(page.getByLabel('Slug')).toHaveValue(createdSlug);
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('button', { name: 'Create workspace' }),
  ).toBeFocused();
  await page.keyboard.press('Enter');

  await expect(page).toHaveURL(new RegExp(`/${createdSlug}$`));
  await expect(page.getByRole('heading', { name: uniqueName })).toBeVisible();
  await expectNoAccessibilityViolations(page);

  await page.getByRole('link', { name: 'Members' }).click();
  await expect(page).toHaveURL(new RegExp(`/${createdSlug}/members$`));
  await expect(
    page.getByRole('heading', { name: `${uniqueName} members` }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Invite member' }).click();
  const inviteDialog = page.getByRole('dialog', { name: 'Invite member' });
  await expect(inviteDialog).toBeVisible();
  await inviteDialog
    .getByLabel('Email')
    .fill(`phase10-${Date.now()}@example.test`);
  await inviteDialog.getByRole('button', { name: 'Send invitation' }).click();
  await expect(page.getByText('The invitation was sent.')).toBeVisible();
  await expect(inviteDialog).toBeHidden();
  await expectNoAccessibilityViolations(page);

  await page.goto(`/${createdSlug}`);
  await page.getByRole('link', { name: 'Settings' }).click();
  const renamedName = `${uniqueName} renamed`;
  const renamedSlug = normalizeOrganizationSlug(`${createdSlug}-new`);
  await page.getByLabel('Name').fill(renamedName);
  await page.getByLabel('Slug').fill(renamedSlug);
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page).toHaveURL(
    new RegExp(`/${renamedSlug}/settings\\?result=success$`),
  );
  await expect(
    page.getByText('Organization settings were updated.'),
  ).toBeVisible();
  await expectNoAccessibilityViolations(page);

  // A 640 CSS-pixel viewport is an automated layout equivalent, not browser zoom.
  await page.setViewportSize({ height: 900, width: 640 });
  await expectNoHorizontalOverflow(page);
  await page.setViewportSize({ height: 640, width: 320 });
  await expectNoHorizontalOverflow(page);

  // The Carbon workspace list and create pages are driven at the shell's normal width.
  await page.setViewportSize({ height: 900, width: 1280 });
  await page.getByRole('link', { name: 'Back to organization' }).click();
  await page.getByRole('link', { name: 'All organizations' }).click();
  await expect(page).toHaveURL(/\/organizations$/);
  // The renamed workspace is a DataGrid row; clicking it navigates to the workspace.
  const renamedRow = page.getByRole('row').filter({ hasText: renamedName });
  await expect(renamedRow).toBeVisible();
  await renamedRow.getByRole('cell', { name: renamedName }).click();
  await expect(page).toHaveURL(new RegExp(`/${renamedSlug}$`));
  await expect(page.getByRole('heading', { name: renamedName })).toBeVisible();

  await page.goto('/organizations');
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page).toHaveURL(/\/organizations\/new$/);
  await expect(page.getByText('Remaining of granted quota: 0')).toBeVisible();
  await expect(
    page.getByText('Workspace creation is not available for this account.'),
  ).toBeVisible();
  await expect(
    page.getByRole('form', { name: 'Create workspace' }),
  ).toHaveCount(0);
  // The quota-exhausted notification must stay within a 320px viewport.
  await page.setViewportSize({ height: 640, width: 320 });
  await expectNoHorizontalOverflow(page);

  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});
