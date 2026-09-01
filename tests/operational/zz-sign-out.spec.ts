import { expect, test } from './authenticated-test';

const organizationId =
  process.env.BAP_OPERATIONAL_ORGANIZATION_ID ?? 'bap-operational';
const password = process.env.BAP_OPERATIONAL_PASSWORD ?? '';

test('signs out after every shared authenticated browser proof', async ({
  page,
}) => {
  test.skip(password.length === 0, 'BAP_OPERATIONAL_PASSWORD is required.');
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });

  await page.goto('/access');
  await expect(
    page.getByRole('heading', { name: 'Organization access' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  const signedOut = await page.request.get(
    `/api/bff/application/organizations/${organizationId}/access`,
  );
  expect(signedOut.status()).toBe(401);
  expect(consoleErrors).toEqual([]);
});
