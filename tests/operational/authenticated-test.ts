import { expect, test as base } from '@playwright/test';

import { signInThroughForm } from './sign-in';

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
        await signInThroughForm(page, email, password);
        await page.close();
      }

      await use(context);
      await context.close();
    },
    // A rate-limited sign-in is waited out, so the shared session gets more than the test budget.
    { scope: 'worker', timeout: 120_000 },
  ],
  page: async ({ authenticatedContext }, use) => {
    const page = await authenticatedContext.newPage();
    await use(page);
    await page.close();
  },
});

export { expect };
