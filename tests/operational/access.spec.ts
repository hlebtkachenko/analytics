import { expect, test as publicTest } from '@playwright/test';

import { expect as authenticatedExpect, test } from './authenticated-test';

const email = process.env.BAP_OPERATIONAL_EMAIL ?? 'owner@bap.invalid';
const organizationId =
  process.env.BAP_OPERATIONAL_ORGANIZATION_ID ?? 'bap-operational';
const password = process.env.BAP_OPERATIONAL_PASSWORD ?? '';

publicTest('protects the public BAP access boundary', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });

  const health = await page.request.get('/health');
  expect(health.ok()).toBe(true);
  const ready = await page.request.get('/ready');
  expect(ready.status()).toBe(404);
  const metrics = await page.request.get('/metrics');
  expect(metrics.status()).toBe(404);
  const root = await page.request.get('/', { maxRedirects: 0 });
  expect(root.status()).toBe(307);
  expect(root.headers()['location']).toMatch(/\/organizations$/);
  const organizations = await page.request.get('/organizations', {
    maxRedirects: 0,
  });
  expect(organizations.status()).toBe(307);
  expect(organizations.headers()['location']).toMatch(/\/sign-in$/);
  expect((await page.request.get('/bap-operational')).status()).toBe(404);
  const unauthenticated = await page.request.get(
    '/api/bff/application/organizations/forged_organization/access',
  );
  expect(unauthenticated.status()).toBe(401);

  const signIn = await page.goto('/sign-in');
  expect(signIn?.headers()['content-security-policy']).toContain(
    'strict-dynamic',
  );
  expect(consoleErrors).toEqual([]);
});

test('protects the authenticated BAP access contract without browser token leakage', async ({
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

  await page.goto('/access');
  await authenticatedExpect(
    page.getByRole('heading', { name: 'Organization access' }),
  ).toBeVisible();
  await authenticatedExpect(page.getByLabel('Organization')).toHaveValue(
    organizationId,
  );
  await authenticatedExpect(
    page.getByText('Application API role: owner'),
  ).toBeVisible();
  await authenticatedExpect(
    page.getByText('Reporting API role: owner'),
  ).toBeVisible();
  await authenticatedExpect
    .poll(() => bffResponses.length)
    .toBeGreaterThanOrEqual(2);

  const services = new Set(
    bffResponses.map((response) => {
      authenticatedExpect(response.status).toBe(200);
      authenticatedExpect(response.headers['set-auth-jwt']).toBeUndefined();
      authenticatedExpect(response.url).toContain(
        `/organizations/${organizationId}/access`,
      );
      authenticatedExpect(response.body).toEqual(
        authenticatedExpect.objectContaining({
          organizationId,
          role: 'owner',
        }),
      );
      authenticatedExpect(response.body).not.toHaveProperty('token');
      return (response.body as { service: string }).service;
    }),
  );
  authenticatedExpect(services).toEqual(
    new Set(['application-api', 'reporting-api']),
  );
  for (const headers of bffRequests) {
    authenticatedExpect(headers.authorization).toBeUndefined();
  }

  const forged = await page.request.get(
    '/api/bff/reporting/organizations/forged_organization/access',
  );
  authenticatedExpect(forged.status()).toBe(403);
  const slugInsteadOfId = await page.request.get(
    '/api/bff/reporting/organizations/bap-operational/access',
  );
  authenticatedExpect(slugInsteadOfId.status()).toBe(403);

  const browserState = await page.evaluate(() => ({
    cookies: document.cookie,
    localStorage: JSON.stringify(localStorage),
    sessionStorage: JSON.stringify(sessionStorage),
    text: document.body.innerText,
    urls: performance.getEntriesByType('resource').map((entry) => entry.name),
  }));
  const visibleState = JSON.stringify(browserState);
  authenticatedExpect(visibleState).not.toContain(email);
  authenticatedExpect(visibleState).not.toContain(password);
  authenticatedExpect(visibleState).not.toMatch(/token|jwt|bearer/i);
  authenticatedExpect(consoleErrors).toEqual([]);
});
