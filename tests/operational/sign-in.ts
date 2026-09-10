import type { APIResponse, Page } from '@playwright/test';

// Better Auth allows 3 sign-in attempts a minute per client, and every spec shares that bucket.
export function rateLimitDelayMs(header: string | undefined): number {
  const seconds = Number.parseInt(header ?? '', 10);
  const bounded =
    Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 60) : 60;
  return bounded * 1_000 + 1_000;
}

// Submits the real sign-in form and waits out a denied attempt instead of failing the run.
export async function signInThroughForm(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.locator('input[name="password"]').fill(password);
  const submit = page.getByRole('button', { name: 'Sign in' });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const pending = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/auth/sign-in/email',
    );
    await submit.click();
    const response = await pending;

    if (response.ok()) {
      return;
    }

    if (response.status() !== 429) {
      throw new Error(`Operational sign-in failed with ${response.status()}.`);
    }

    await page.waitForTimeout(
      rateLimitDelayMs(response.headers()['x-retry-after']),
    );
  }

  throw new Error('Operational sign-in stayed rate limited.');
}

// The same rule applies to a direct probe, so a denial is waited out before the status is asserted.
export async function postSignInProbe(
  page: Page,
  data: Readonly<Record<string, string>>,
  headers: Readonly<Record<string, string>>,
): Promise<APIResponse> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await page.request.post('/api/auth/sign-in/email', {
      data,
      headers,
    });

    if (response.status() !== 429) {
      return response;
    }

    await page.waitForTimeout(
      rateLimitDelayMs(response.headers()['x-retry-after']),
    );
  }

  throw new Error('Operational sign-in stayed rate limited.');
}
