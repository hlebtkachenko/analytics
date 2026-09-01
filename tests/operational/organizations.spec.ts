import axe from 'axe-core';

import { normalizeOrganizationSlug } from '../../apps/web/src/lib/organizations/slug';
import { expect, test } from './authenticated-test';

const password = process.env.BAP_OPERATIONAL_PASSWORD ?? '';

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

async function expectNoAccessibilityViolations(
  page: import('@playwright/test').Page,
) {
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

test('walks the temporary organization loop through explicit member-scoped actions', async ({
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
  await expect(
    page.getByRole('heading', { name: 'Organizations' }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'BAP Operational' }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Create organization' }).click();
  await expect(page).toHaveURL(/\/organizations\/new$/);
  await expect(page.getByText('Remaining creation quota: 1')).toBeVisible();

  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('link', { name: 'Back to organizations' }),
  ).toBeFocused();
  await page.keyboard.press('Tab');
  const nameInput = page.getByLabel('Name');
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
    page.getByRole('button', { name: 'Create organization' }),
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
  await expect(page.getByRole('form', { name: 'Invite member' })).toBeVisible();
  await page.getByLabel('Email').fill(`phase10-${Date.now()}@example.test`);
  await page.getByRole('button', { name: 'Send invitation' }).click();
  await expect(page).toHaveURL(/\/members\?result=success$/);
  await expect(
    page.getByText('The organization membership was updated.'),
  ).toBeVisible();
  await expectNoAccessibilityViolations(page);

  await page.getByRole('link', { name: 'Back to organization' }).click();
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
  await page.setViewportSize({ height: 640, width: 360 });
  await expectNoHorizontalOverflow(page);

  await page.getByRole('link', { name: 'Back to organization' }).click();
  await page.getByRole('link', { name: 'All organizations' }).click();
  await expect(page.getByRole('link', { name: renamedName })).toHaveAttribute(
    'href',
    `/${renamedSlug}`,
  );
  await page.getByRole('link', { name: 'Create organization' }).click();
  await expect(page.getByText('Remaining creation quota: 0')).toBeVisible();
  await expect(
    page.getByText('Organization creation is not available for this account.'),
  ).toBeVisible();
  await expect(
    page.getByRole('form', { name: 'Create organization' }),
  ).toHaveCount(0);
  await expectNoHorizontalOverflow(page);

  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});
