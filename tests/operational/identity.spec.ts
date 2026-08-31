import { expect, test } from '@playwright/test';
import axe from 'axe-core';

const resetCapability = 'ResetSentinelTokenAbc123';
const resetErrorCode = 'PRIVATE_RESET_CALLBACK_CODE';
const activationErrorCode = 'PRIVATE_ACTIVATION_CODE';

type AxeViolation = Readonly<{
  id: string;
  impact: string | null;
  nodes: ReadonlyArray<Readonly<{ target: ReadonlyArray<string> }>>;
}>;

type AxeWindow = Window &
  typeof globalThis & {
    axe: {
      run: (document: Document) => Promise<{ violations: AxeViolation[] }>;
    };
  };

async function scanIdentityPage(page: import('@playwright/test').Page) {
  await page.evaluate(axe.source);
  return page.evaluate(async () => {
    const results = await (window as AxeWindow).axe.run(document);
    return results.violations;
  });
}

async function getAccessibilityItems(page: import('@playwright/test').Page) {
  const session = await page.context().newCDPSession(page);
  await session.send('Accessibility.enable');
  const { nodes } = await session.send('Accessibility.getFullAXTree');
  await session.detach();

  return nodes
    .filter((node) => !node.ignored)
    .map((node) => ({
      role: String(node.role?.value ?? ''),
      name: String(node.name?.value ?? ''),
    }));
}

test('canonicalizes callback secrets before production HTML and RSC rendering', async ({
  page,
}) => {
  const resetRedirect = await page.request.get(
    `/reset-password?token=${resetCapability}`,
    { maxRedirects: 0 },
  );
  expect(resetRedirect.status()).toBe(307);
  expect(resetRedirect.headers()['location']).toMatch(/\/reset-password$/);
  expect(resetRedirect.headers()['referrer-policy']).toBe('no-referrer');
  expect(await resetRedirect.text()).not.toContain(resetCapability);
  const setCookie = resetRedirect.headers()['set-cookie'];
  expect(setCookie).toMatch(/bap_reset_capability=.*HttpOnly/i);
  expect(setCookie).toMatch(/Max-Age=1800/i);
  expect(setCookie).toMatch(/Path=\/reset-password/i);
  expect(setCookie).toMatch(/SameSite=lax/i);
  expect(setCookie).toMatch(/Secure/i);

  const resetPage = await page.goto(`/reset-password?token=${resetCapability}`);
  await page.waitForLoadState('networkidle');
  expect(page.url()).toMatch(/\/reset-password$/);
  expect(resetPage?.headers()['referrer-policy']).toBe('no-referrer');
  expect(await resetPage?.text()).not.toContain(resetCapability);
  expect(await page.content()).not.toContain(resetCapability);
  expect(await page.locator('body').innerText()).not.toContain(resetCapability);
  expect(await page.evaluate(() => document.cookie)).not.toContain(
    resetCapability,
  );

  const capability = (await page.context().cookies()).find(
    (cookie) => cookie.name === 'bap_reset_capability',
  );
  expect(capability).toMatchObject({
    httpOnly: true,
    path: '/reset-password',
    sameSite: 'Lax',
    secure: true,
    value: resetCapability,
  });

  await page.locator('input[name="newPassword"]').fill('replacement-password');
  await page
    .locator('input[name="confirmPassword"]')
    .fill('replacement-password');
  type ActionResponse = Readonly<{
    body: string;
    postData: string | null;
  }>;
  let resolveActionResponse!: (response: ActionResponse) => void;
  let rejectActionResponse!: (error: Error) => void;
  const actionResponsePromise = new Promise<ActionResponse>(
    (resolve, reject) => {
      resolveActionResponse = resolve;
      rejectActionResponse = reject;
    },
  );
  await page.route(
    '**/reset-password',
    async (route) => {
      try {
        const request = route.request();
        expect(request.method()).toBe('POST');
        const response = await route.fetch();
        const body = await response.body();
        await route.fulfill({ body, response });
        resolveActionResponse({
          body: body.toString('utf8'),
          postData: request.postData(),
        });
      } catch (error) {
        await route.abort().catch(() => undefined);
        rejectActionResponse(
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    },
    { times: 1 },
  );
  await page.getByRole('button', { name: 'Update password' }).click();
  const actionResponse = await actionResponsePromise;

  expect(actionResponse.postData).not.toContain(resetCapability);
  expect(actionResponse.body).not.toContain(resetCapability);
  await expect(
    page.getByText('This password reset link is invalid or expired.'),
  ).toBeVisible();
  expect(
    (await page.context().cookies()).some(
      (cookie) => cookie.name === 'bap_reset_capability',
    ),
  ).toBe(false);

  const activationRedirect = await page.request.get(
    `/activate?error=${activationErrorCode}`,
    { maxRedirects: 0 },
  );
  expect(activationRedirect.status()).toBe(307);
  expect(activationRedirect.headers()['location']).toMatch(
    /\/activate\?state=invalid$/,
  );
  expect(activationRedirect.headers()['referrer-policy']).toBe('no-referrer');
  expect(await activationRedirect.text()).not.toContain(activationErrorCode);

  const activationPage = await page.goto(
    `/activate?error=${activationErrorCode}`,
  );
  await page.waitForLoadState('networkidle');
  expect(page.url()).toMatch(/\/activate\?state=invalid$/);
  expect(activationPage?.headers()['referrer-policy']).toBe('no-referrer');
  expect(await activationPage?.text()).not.toContain(activationErrorCode);
  expect(await page.content()).not.toContain(activationErrorCode);
  expect(await page.locator('body').innerText()).not.toContain(
    activationErrorCode,
  );
});

test('canonicalizes sensitive callbacks for every prefetch header variant', async ({
  page,
}) => {
  const prefetchHeaders: ReadonlyArray<{
    label: string;
    values: Record<string, string>;
  }> = [
    { label: 'Purpose', values: { purpose: 'prefetch', rsc: '1' } },
    {
      label: 'Next-Router-Prefetch',
      values: { 'next-router-prefetch': '1', rsc: '1' },
    },
  ];

  for (const prefetch of prefetchHeaders) {
    const resetTokenResponse = await page.request.get(
      `/reset-password?token=${resetCapability}`,
      { headers: prefetch.values, maxRedirects: 0 },
    );
    expect(resetTokenResponse.status(), prefetch.label).toBe(307);
    expect(resetTokenResponse.headers()['location'], prefetch.label).toMatch(
      /\/reset-password$/,
    );
    expect(
      resetTokenResponse.headers()['referrer-policy'],
      prefetch.label,
    ).toBe('no-referrer');
    expect(await resetTokenResponse.text(), prefetch.label).not.toContain(
      resetCapability,
    );
    const setCookie = resetTokenResponse.headers()['set-cookie'];
    expect(setCookie, prefetch.label).toMatch(
      /bap_reset_capability=.*HttpOnly/i,
    );
    expect(setCookie, prefetch.label).toMatch(/Max-Age=1800/i);
    expect(setCookie, prefetch.label).toMatch(/Path=\/reset-password/i);
    expect(setCookie, prefetch.label).toMatch(/SameSite=lax/i);
    expect(setCookie, prefetch.label).toMatch(/Secure/i);

    const resetErrorResponse = await page.request.get(
      `/reset-password?error=${resetErrorCode}&token=${resetCapability}`,
      { headers: prefetch.values, maxRedirects: 0 },
    );
    expect(resetErrorResponse.status(), prefetch.label).toBe(307);
    expect(resetErrorResponse.headers()['location'], prefetch.label).toMatch(
      /\/reset-password$/,
    );
    expect(
      resetErrorResponse.headers()['referrer-policy'],
      prefetch.label,
    ).toBe('no-referrer');
    const resetErrorBody = await resetErrorResponse.text();
    expect(resetErrorBody, prefetch.label).not.toContain(resetCapability);
    expect(resetErrorBody, prefetch.label).not.toContain(resetErrorCode);
    const clearedCookie = resetErrorResponse.headers()['set-cookie'];
    expect(clearedCookie, prefetch.label).toMatch(/bap_reset_capability=;/i);
    expect(clearedCookie, prefetch.label).toMatch(/Max-Age=0/i);
    expect(clearedCookie, prefetch.label).toMatch(/HttpOnly/i);
    expect(clearedCookie, prefetch.label).toMatch(/Path=\/reset-password/i);
    expect(clearedCookie, prefetch.label).toMatch(/SameSite=lax/i);
    expect(clearedCookie, prefetch.label).toMatch(/Secure/i);
    expect(clearedCookie, prefetch.label).not.toContain(resetCapability);

    const activationResponse = await page.request.get(
      `/activate?error=${activationErrorCode}`,
      { headers: prefetch.values, maxRedirects: 0 },
    );
    expect(activationResponse.status(), prefetch.label).toBe(307);
    expect(activationResponse.headers()['location'], prefetch.label).toMatch(
      /\/activate\?state=invalid$/,
    );
    expect(
      activationResponse.headers()['referrer-policy'],
      prefetch.label,
    ).toBe('no-referrer');
    expect(await activationResponse.text(), prefetch.label).not.toContain(
      activationErrorCode,
    );
  }
});

test('supports keyboard-only operation across the identity recovery path', async ({
  page,
}) => {
  await page.goto('/sign-in');
  await page.waitForLoadState('networkidle');

  await page.keyboard.press('Tab');
  await expect(page.locator('input[name="email"]')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('input[name="password"]')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('button', { name: 'Show password' }),
  ).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('link', { name: 'Forgot your password?' }),
  ).toBeFocused();
  await page.keyboard.press('Enter');
  await page.waitForURL(/\/forgot-password$/);
  await page.waitForLoadState('networkidle');

  await page.keyboard.press('Tab');
  await expect(page.locator('input[name="email"]')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('button', { name: 'Send reset link' }),
  ).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('link', { name: 'Back to sign in' }),
  ).toBeFocused();

  await page.goto('/reset-password');
  await page.waitForLoadState('networkidle');
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('link', { name: 'Request a new reset link' }),
  ).toBeFocused();
  await page.keyboard.press('Enter');
  await page.waitForURL(/\/forgot-password$/);

  await page.goto('/activate?state=invalid');
  await page.waitForLoadState('networkidle');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeFocused();
});

test('has no axe violations on representative identity states', async ({
  page,
}) => {
  const routes = [
    '/sign-in',
    '/sign-in/two-factor',
    '/sign-up',
    '/forgot-password',
    '/reset-password',
    '/activate?state=invalid',
  ];

  for (const route of routes) {
    await page.goto(route);
    await page.waitForLoadState('networkidle');
    const violations = await scanIdentityPage(page);
    expect(violations, `${route}: ${JSON.stringify(violations)}`).toEqual([]);
  }
});

test('exposes expected Chromium accessibility roles and names', async ({
  page,
}) => {
  await page.goto('/sign-in');
  await page.waitForLoadState('networkidle');

  const signInItems = await getAccessibilityItems(page);
  expect(signInItems).toEqual(
    expect.arrayContaining([
      { role: 'heading', name: 'Sign in to BAP' },
      { role: 'textbox', name: 'Email address' },
      { role: 'textbox', name: 'Password' },
      { role: 'button', name: 'Show password' },
      { role: 'link', name: 'Forgot your password?' },
      { role: 'button', name: 'Sign in' },
    ]),
  );

  await page.goto('/forgot-password');
  await page.waitForLoadState('networkidle');

  const forgotPasswordItems = await getAccessibilityItems(page);
  expect(forgotPasswordItems).toEqual(
    expect.arrayContaining([
      { role: 'heading', name: 'Reset your password' },
      { role: 'textbox', name: 'Email address' },
      { role: 'button', name: 'Send reset link' },
      { role: 'link', name: 'Back to sign in' },
    ]),
  );
});
