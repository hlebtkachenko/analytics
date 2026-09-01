import { expect, test as base } from '@playwright/test';

const baseURL =
  process.env.BAP_OPERATIONAL_BASE_URL ?? 'http://localhost:39100';
const email = process.env.BAP_OPERATIONAL_EMAIL ?? 'owner@bap.invalid';
const password = process.env.BAP_OPERATIONAL_PASSWORD ?? '';

export const test = base.extend<
  Record<string, never>,
  { authenticatedContext: import('@playwright/test').BrowserContext }
>({
  authenticatedContext: [
    async ({ browser }, use) => {
      const context = await browser.newContext({ baseURL });

      if (password.length > 0) {
        const page = await context.newPage();
        await page.goto('/sign-in');
        await page.getByLabel('Email address').fill(email);
        await page.locator('input[name="password"]').fill(password);
        const signedIn = page.waitForResponse(
          (response) =>
            response.request().method() === 'POST' &&
            response.url().includes('/api/auth/sign-in/email'),
        );
        await page.getByRole('button', { name: 'Sign in' }).click();
        const response = await signedIn;

        if (!response.ok()) {
          throw new Error(
            `Operational sign-in failed with ${response.status()}.`,
          );
        }

        await page.close();
      }

      await use(context);
      await context.close();
    },
    { scope: 'worker' },
  ],
  page: async ({ authenticatedContext }, use) => {
    const page = await authenticatedContext.newPage();
    await use(page);
    await page.close();
  },
});

export { expect };
