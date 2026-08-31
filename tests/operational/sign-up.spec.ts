import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';

import { expect, test } from '@playwright/test';
import type { APIResponse, Page } from '@playwright/test';

const execFileAsync = promisify(execFile);
const mailpitUrl =
  process.env.BAP_OPERATIONAL_MAILPIT_URL ?? 'http://127.0.0.1:39825';
const mailpitConsistencyObservationMs = 1_000;

test.describe.configure({ mode: 'serial' });

async function setPublicSignup(enabled: boolean): Promise<void> {
  try {
    const { stdout } = await execFileAsync(
      'docker',
      [
        'compose',
        '-f',
        'compose.yaml',
        '-f',
        'compose.development.yaml',
        '-f',
        'compose.mailpit.yaml',
        'run',
        '--rm',
        '--no-deps',
        'migrator',
        'node',
        'node_modules/@bap/db/dist/cli.js',
        'signup',
        enabled ? 'enable' : 'disable',
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        timeout: 30_000,
      },
    );
    const result: unknown = JSON.parse(stdout);
    if (
      typeof result !== 'object' ||
      result === null ||
      !('publicSignupEnabled' in result) ||
      result.publicSignupEnabled !== enabled
    ) {
      throw new Error('Unexpected public sign-up state.');
    }
  } catch {
    throw new Error('Could not set public sign-up state.');
  }
}

async function assertSignUpPage(page: Page, enabled: boolean): Promise<void> {
  await page.goto('/sign-up');
  await page.waitForLoadState('networkidle');

  const form = page.getByRole('form', { name: 'Create your BAP account' });
  const closed = page.getByText('Account creation is not available right now.');
  if (enabled) {
    await expect(form).toBeVisible();
    await expect(closed).toHaveCount(0);
  } else {
    await expect(form).toHaveCount(0);
    await expect(closed).toBeVisible();
  }
}

function setCookieHeaders(response: APIResponse): string[] {
  return response
    .headersArray()
    .filter((header) => header.name.toLowerCase() === 'set-cookie')
    .map((header) => header.value);
}

function withoutGeneratedIdentityFields(value: unknown): unknown {
  const normalized = structuredClone(value);
  if (
    typeof normalized === 'object' &&
    normalized !== null &&
    'user' in normalized &&
    typeof normalized.user === 'object' &&
    normalized.user !== null
  ) {
    delete (normalized.user as Record<string, unknown>).id;
    delete (normalized.user as Record<string, unknown>).createdAt;
    delete (normalized.user as Record<string, unknown>).updatedAt;
  }
  return normalized;
}

function assertNoSessionCookies(cookies: string[]): void {
  if (cookies.length !== 0) {
    throw new Error('Authentication response unexpectedly set a cookie.');
  }
}

function assertEqualCookies(actual: string[], expected: string[]): void {
  if (
    actual.length !== expected.length ||
    actual.some((cookie, index) => cookie !== expected[index])
  ) {
    throw new Error('Authentication response cookie headers differed.');
  }
}

function assertTokenlessResponse(body: unknown, password: string): void {
  if (
    typeof body !== 'object' ||
    body === null ||
    !('token' in body) ||
    body.token !== null
  ) {
    throw new Error('Authentication response unexpectedly contained a token.');
  }
  const serialized = JSON.stringify(body);
  if (
    serialized.includes(password) ||
    serialized.includes('/verify-email?token=') ||
    serialized.includes('sessionToken')
  ) {
    throw new Error('Authentication response exposed sensitive material.');
  }
}

function assertPasswordAbsent(body: unknown, password: string): void {
  if (JSON.stringify(body).includes(password)) {
    throw new Error('Authentication response exposed sensitive material.');
  }
}

async function readJson(response: APIResponse): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new Error('Authentication response was not valid JSON.');
  }
}

async function mailMessageIds(recipient: string): Promise<string[]> {
  try {
    const url = new URL('/api/v1/search', mailpitUrl);
    url.searchParams.set('query', `to:${recipient}`);
    url.searchParams.set('start', '0');
    url.searchParams.set('limit', '50');
    const response = await fetch(url, { signal: AbortSignal.timeout(3_000) });
    if (!response.ok) {
      throw new Error('Mail sink rejected the query.');
    }
    const body: unknown = await response.json();
    if (
      typeof body !== 'object' ||
      body === null ||
      !('messages' in body) ||
      !Array.isArray(body.messages)
    ) {
      throw new Error('Mail sink returned an invalid response.');
    }
    return body.messages.map((message) => {
      if (
        typeof message !== 'object' ||
        message === null ||
        !('ID' in message) ||
        typeof message.ID !== 'string'
      ) {
        throw new Error('Mail sink returned an invalid message.');
      }
      return message.ID;
    });
  } catch {
    throw new Error('Could not query the development mail sink.');
  }
}

async function waitForFreshMessage(recipient: string): Promise<string> {
  const deadline = Date.now() + 3_000;
  do {
    const ids = await mailMessageIds(recipient);
    if (ids.length === 1) {
      return ids[0] ?? '';
    }
    if (ids.length > 1) {
      throw new Error('Fresh sign-up sent more than one verification message.');
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  } while (Date.now() < deadline);

  throw new Error('Fresh sign-up did not send one verification message.');
}

async function expectMessageSetUnchanged(
  recipient: string,
  expectedIds: string[],
): Promise<void> {
  const deadline = Date.now() + mailpitConsistencyObservationMs;
  do {
    const actualIds = await mailMessageIds(recipient);
    if (
      actualIds.length !== expectedIds.length ||
      actualIds.some((id, index) => id !== expectedIds[index])
    ) {
      throw new Error('Mail sink recipient message set changed unexpectedly.');
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  } while (Date.now() < deadline);
}

test('restricts the development mail inspection proxy', async () => {
  const probes = [
    { method: 'GET', path: '/readyz', status: 200 },
    {
      method: 'GET',
      path: '/api/v1/search?query=to%3Aprobe%40example.test',
      status: 200,
    },
    { method: 'GET', path: '/', status: 404 },
    { method: 'GET', path: '/api/v1/messages', status: 404 },
    { method: 'GET', path: '/api/v1/search/', status: 404 },
    { method: 'POST', path: '/api/v1/search', status: 404 },
    { method: 'HEAD', path: '/readyz', status: 404 },
  ] as const;

  for (const probe of probes) {
    const response = await fetch(new URL(probe.path, mailpitUrl), {
      method: probe.method,
      redirect: 'manual',
      signal: AbortSignal.timeout(3_000),
    });
    expect(response.status).toBe(probe.status);
  }
});

test('proves the public sign-up lifecycle through Caddy', async ({ page }) => {
  test.setTimeout(60_000);
  const suffix = `${Date.now()}-${randomUUID()}`;
  const email = `signup-${suffix}@example.test`;
  const rateLimitedEmail = `limited-${suffix}@example.test`;
  const password = `Operational-${randomUUID()}`;
  const body = {
    callbackURL: '/activate',
    email,
    name: 'Operational Sign-up',
    password,
  };
  const origin = new URL(
    process.env.BAP_OPERATIONAL_BASE_URL ?? 'http://localhost:39100',
  ).origin;
  const headers = {
    'content-type': 'application/json',
    origin,
  };

  try {
    await setPublicSignup(false);
    await assertSignUpPage(page, false);

    // Attempt 1 is rejected by policy after consuming the edge-rate bucket.
    const closedResponse = await page.request.post('/api/auth/sign-up/email', {
      data: body,
      headers,
    });
    expect(closedResponse.status()).toBe(403);
    assertNoSessionCookies(setCookieHeaders(closedResponse));
    assertPasswordAbsent(await readJson(closedResponse), password);

    await setPublicSignup(true);
    await assertSignUpPage(page, true);

    // Attempts 2 and 3 are the fresh and identical duplicate requests.
    const freshResponse = await page.request.post('/api/auth/sign-up/email', {
      data: body,
      headers,
    });
    const freshBody = await readJson(freshResponse);
    const freshCookies = setCookieHeaders(freshResponse);
    expect(freshResponse.status()).toBe(200);
    assertNoSessionCookies(freshCookies);
    assertTokenlessResponse(freshBody, password);

    const freshMessageId = await waitForFreshMessage(email);
    expect(freshMessageId).not.toBe('');

    const duplicateResponse = await page.request.post(
      '/api/auth/sign-up/email',
      { data: body, headers },
    );
    const duplicateBody = await readJson(duplicateResponse);
    const duplicateCookies = setCookieHeaders(duplicateResponse);
    expect(duplicateResponse.status()).toBe(freshResponse.status());
    assertEqualCookies(duplicateCookies, freshCookies);
    assertTokenlessResponse(duplicateBody, password);
    expect(withoutGeneratedIdentityFields(duplicateBody)).toEqual(
      withoutGeneratedIdentityFields(freshBody),
    );

    expect(await mailMessageIds(email)).toEqual([freshMessageId]);
    await expectMessageSetUnchanged(email, [freshMessageId]);

    const signInResponse = await page.request.post('/api/auth/sign-in/email', {
      data: { email, password },
      headers,
    });
    expect(signInResponse.status()).toBe(403);
    assertNoSessionCookies(setCookieHeaders(signInResponse));
    assertPasswordAbsent(await readJson(signInResponse), password);

    // Attempt 4 shares the same Caddy-established client bucket and must be limited.
    const limitedResponse = await page.request.post('/api/auth/sign-up/email', {
      data: { ...body, email: rateLimitedEmail },
      headers,
    });
    expect(limitedResponse.status()).toBe(429);
    assertNoSessionCookies(setCookieHeaders(limitedResponse));
    assertPasswordAbsent(await readJson(limitedResponse), password);
    expect(await mailMessageIds(rateLimitedEmail)).toEqual([]);
    await expectMessageSetUnchanged(rateLimitedEmail, []);
  } finally {
    await setPublicSignup(false);
  }
});
