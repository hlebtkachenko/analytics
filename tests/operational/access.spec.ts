import { expect, test } from '@playwright/test';

const email = process.env.BAP_OPERATIONAL_EMAIL ?? 'owner@bap.invalid';
const organizationId =
  process.env.BAP_OPERATIONAL_ORGANIZATION_ID ?? 'bap-operational';
const password = process.env.BAP_OPERATIONAL_PASSWORD ?? '';

test('protects the public BAP access contract without browser token leakage', async ({
  page,
}) => {
  test.skip(password.length === 0, 'BAP_OPERATIONAL_PASSWORD is required.');
  const consoleErrors: string[] = [];
  const bffRequests: Array<Record<string, string>> = [];
  const bffResponses: Array<{
    body: unknown;
    headers: Record<string, string>;
    status: number;
    url: string;
  }> = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });
  page.on('request', (request) => {
    if (request.url().includes('/api/bff/')) {
      bffRequests.push(request.headers());
    }
  });
  page.on('response', async (response) => {
    if (!response.url().includes('/api/bff/')) {
      return;
    }

    const status = response.status();
    bffResponses.push({
      body: response.headers()['content-type']?.includes('application/json')
        ? await response.json()
        : null,
      headers: response.headers(),
      status,
      url: response.url(),
    });
  });

  const health = await page.request.get('/health');
  expect(health.ok()).toBe(true);
  const ready = await page.request.get('/ready');
  expect(ready.status()).toBe(404);
  const metrics = await page.request.get('/metrics');
  expect(metrics.status()).toBe(404);
  const unauthenticated = await page.request.get(
    '/api/bff/application/organizations/forged_organization/access',
  );
  expect(unauthenticated.status()).toBe(401);

  const signIn = await page.goto('/sign-in');
  expect(signIn?.headers()['content-security-policy']).toContain(
    'strict-dynamic',
  );
  await page.getByLabel('Email address').fill(email);
  await page.locator('input[name="password"]').fill(password);
  const signedIn = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().includes('/api/auth/sign-in/email'),
  );
  await page.getByRole('button', { name: 'Sign in' }).click();
  expect((await signedIn).ok()).toBe(true);

  await page.goto('/access');
  await expect(
    page.getByRole('heading', { name: 'Organization access' }),
  ).toBeVisible();
  await expect(page.getByText('Application API role: owner')).toBeVisible();
  await expect(page.getByText('Reporting API role: owner')).toBeVisible();
  await expect.poll(() => bffResponses.length).toBeGreaterThanOrEqual(2);

  const services = new Set(
    bffResponses.map((response) => {
      expect(response.status).toBe(200);
      expect(response.headers['set-auth-jwt']).toBeUndefined();
      expect(response.url).toContain(`/organizations/${organizationId}/access`);
      expect(response.body).toEqual(
        expect.objectContaining({ organizationId, role: 'owner' }),
      );
      expect(response.body).not.toHaveProperty('token');
      return (response.body as { service: string }).service;
    }),
  );
  expect(services).toEqual(new Set(['application-api', 'reporting-api']));
  for (const headers of bffRequests) {
    expect(headers.authorization).toBeUndefined();
  }

  const forged = await page.request.get(
    '/api/bff/reporting/organizations/forged_organization/access',
  );
  expect(forged.status()).toBe(403);

  const browserState = await page.evaluate(() => ({
    cookies: document.cookie,
    localStorage: JSON.stringify(localStorage),
    sessionStorage: JSON.stringify(sessionStorage),
    text: document.body.innerText,
    urls: performance.getEntriesByType('resource').map((entry) => entry.name),
  }));
  const visibleState = JSON.stringify(browserState);
  expect(visibleState).not.toContain(email);
  expect(visibleState).not.toContain(password);
  expect(visibleState).not.toMatch(/token|jwt|bearer/i);

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  const signedOut = await page.request.get(
    `/api/bff/application/organizations/${organizationId}/access`,
  );
  expect(signedOut.status()).toBe(401);
  expect(consoleErrors).toEqual([]);
});
