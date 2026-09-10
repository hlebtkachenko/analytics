import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual, promisify } from 'node:util';

import { expect, test as publicTest } from '@playwright/test';
import type { APIResponse, Page, Response } from '@playwright/test';

import { test } from './authenticated-test';

const execFileAsync = promisify(execFile);
const mailpitUrl =
  process.env.BAP_OPERATIONAL_MAILPIT_URL ?? 'http://127.0.0.1:39825';
const mailpitConsistencyObservationMs = 1_000;
const operationalOrganizationId =
  process.env.BAP_OPERATIONAL_ORGANIZATION_ID ?? 'bap-operational';
const operationalOrganizationSlug =
  process.env.BAP_OPERATIONAL_ORGANIZATION_SLUG ?? 'bap-operational';
const operationalPassword = process.env.BAP_OPERATIONAL_PASSWORD ?? '';

publicTest.describe.configure({ mode: 'serial' });

function composeArguments(command: readonly string[]): string[] {
  const project = process.env.BAP_OPERATIONAL_COMPOSE_PROJECT;
  return [
    'compose',
    ...(project ? ['--project-name', project] : []),
    '-f',
    'compose.yaml',
    '-f',
    'compose.development.yaml',
    '-f',
    'compose.mailpit.yaml',
    ...command,
  ];
}

async function setPublicSignup(enabled: boolean): Promise<void> {
  try {
    const { stdout } = await execFileAsync(
      'docker',
      composeArguments([
        'run',
        '--rm',
        '--no-deps',
        'migrator',
        'node',
        'node_modules/@bap/db/dist/cli.js',
        'signup',
        enabled ? 'enable' : 'disable',
      ]),
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
  const invitationOnly = page.getByText(
    'Account creation requires an invitation.',
  );
  await expect(form).toBeVisible();
  if (enabled) {
    await expect(invitationOnly).toHaveCount(0);
  } else {
    await expect(invitationOnly).toBeVisible();
    await expect(
      page.getByText(
        'If you received an organization invitation, create the account using the invited email address.',
      ),
    ).toBeVisible();
  }
}

async function setCookieHeaders(
  response: APIResponse | Response,
): Promise<string[]> {
  return (await response.headersArray())
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

async function readJson(response: APIResponse | Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new Error('Authentication response was not valid JSON.');
  }
}

async function navigateToSensitivePath(
  page: Page,
  path: string,
): Promise<void> {
  await page.evaluate((target) => window.location.assign(target), path);
}

async function mailMessageIds(
  recipient: string,
  subject?: string,
): Promise<string[]> {
  try {
    const url = new URL('/api/v1/search', mailpitUrl);
    url.searchParams.set(
      'query',
      `to:${recipient}${subject ? ` subject:"${subject}"` : ''}`,
    );
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
    const ids = await mailMessageIds(
      recipient,
      'Confirm your BAP email address',
    );
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
    const actualIds = await mailMessageIds(
      recipient,
      'Confirm your BAP email address',
    );
    if (
      actualIds.length !== expectedIds.length ||
      actualIds.some((id, index) => id !== expectedIds[index])
    ) {
      throw new Error('Mail sink recipient message set changed unexpectedly.');
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  } while (Date.now() < deadline);
}

const verificationRedirectScript = String.raw`
import { createServer } from 'node:http';

let input = '';
for await (const chunk of process.stdin) input += chunk;
const parsed = JSON.parse(input);
if (
  typeof parsed !== 'object' ||
  parsed === null ||
  typeof parsed.recipient !== 'string' ||
  typeof parsed.publicOrigin !== 'string'
) process.exit(1);

const publicOrigin = new URL(parsed.publicOrigin).origin;
const query = new URLSearchParams({
  limit: '50',
  query: 'to:' + parsed.recipient + ' subject:"Confirm your BAP email address"',
  start: '0',
});
let messageId;
const deadline = Date.now() + 3000;
do {
  const response = await fetch('http://mailpit:8025/api/v1/search?' + query);
  if (!response.ok) process.exit(1);
  const body = await response.json();
  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (messages.length > 1) process.exit(1);
  messageId = messages[0]?.ID;
  if (typeof messageId !== 'string') {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
} while (typeof messageId !== 'string' && Date.now() < deadline);
if (typeof messageId !== 'string') process.exit(1);

const messageResponse = await fetch(
  'http://mailpit:8025/api/v1/message/' + encodeURIComponent(messageId),
);
if (!messageResponse.ok) process.exit(1);
const message = await messageResponse.json();
const strings = [];
const collect = (value) => {
  if (typeof value === 'string') strings.push(value);
  else if (Array.isArray(value)) value.forEach(collect);
  else if (typeof value === 'object' && value !== null) {
    Object.values(value).forEach(collect);
  }
};
collect(message);
const candidates = strings.flatMap(
  (value) => value.match(/https?:\/\/[^\s<>"']+/g) ?? [],
);
const verificationUrls = candidates
  .map((value) => value.replaceAll('&amp;', '&'))
  .map((value) => {
    try {
      return new URL(value);
    } catch {
      return null;
    }
  })
  .filter(
    (value) =>
      value !== null &&
      value.origin === publicOrigin &&
      value.pathname === '/api/auth/verify-email' &&
      value.searchParams.has('token'),
  );
if (verificationUrls.length !== 1) process.exit(1);

const verificationUrl = verificationUrls[0];
const server = createServer((request, response) => {
  if (request.method !== 'GET' || request.url !== '/verify') {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(302, { location: verificationUrl.href }).end();
  setTimeout(() => server.close(), 0);
});
server.listen(8080, '0.0.0.0', () => process.stdout.write('READY\n'));
setTimeout(() => process.exit(1), 30000).unref();
`;

async function startVerificationRedirect(recipient: string): Promise<
  Readonly<{
    completed: Promise<void>;
    stop: () => Promise<void>;
    url: string;
  }>
> {
  const port = Number(
    process.env.BAP_OPERATIONAL_VERIFICATION_REDIRECT_PORT ?? '39102',
  );
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error('Invalid verification redirect port.');
  }

  const child = spawn(
    'docker',
    composeArguments([
      'run',
      '--rm',
      '--no-deps',
      '-T',
      '-p',
      `127.0.0.1:${String(port)}:8080`,
      'web',
      'node',
      '--input-type=module',
      '-e',
      verificationRedirectScript,
    ]),
    { cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'] },
  );
  child.stderr.resume();
  child.stdin.end(
    JSON.stringify({
      publicOrigin: new URL(
        process.env.BAP_OPERATIONAL_BASE_URL ?? 'http://localhost:39100',
      ).origin,
      recipient,
    }),
  );

  let settled = false;
  const completed = new Promise<void>((resolve, reject) => {
    child.once('error', () => {
      if (!settled) {
        settled = true;
        reject(new Error('Verification redirect could not start.'));
      }
    });
    child.once('close', (code) => {
      if (!settled) {
        settled = true;
        if (code === 0) resolve();
        else reject(new Error('Verification redirect failed.'));
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => {
      reject(new Error('Verification redirect timed out.'));
    }, 10_000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      output += chunk;
      if (output.includes('READY\n')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    completed.catch((error: unknown) => {
      clearTimeout(timeout);
      reject(error);
    });
  });

  return {
    completed,
    stop: async () => {
      if (!settled) child.kill('SIGTERM');
      await completed.catch(() => undefined);
    },
    url: `http://127.0.0.1:${String(port)}/verify`,
  };
}

publicTest('restricts the development mail inspection proxy', async () => {
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

test('proves invitation-only registration, acceptance, and membership management through Caddy', async ({
  browser,
  page,
}) => {
  test.skip(
    operationalPassword.length === 0,
    'BAP_OPERATIONAL_PASSWORD is required.',
  );
  test.setTimeout(90_000);
  const suffix = `${Date.now()}-${randomUUID()}`;
  const email = `invited-${suffix}@example.test`;
  const closedEmail = `closed-${suffix}@example.test`;
  const rateLimitedEmail = `limited-${suffix}@example.test`;
  const password = `Operational-${randomUUID()}`;
  const body = {
    callbackURL: '/activate',
    email,
    name: 'Invited Operator',
    password,
  };
  const origin = new URL(
    process.env.BAP_OPERATIONAL_BASE_URL ?? 'http://localhost:39100',
  ).origin;
  const headers = {
    'content-type': 'application/json',
    origin,
  };
  const recipientContext = await browser.newContext({ baseURL: origin });
  const recipientPage = await recipientContext.newPage();
  let verificationRedirect:
    Awaited<ReturnType<typeof startVerificationRedirect>> | undefined;

  try {
    await setPublicSignup(false);
    await assertSignUpPage(recipientPage, false);
    await recipientPage.goto('/sign-in');
    await expect(
      recipientPage.getByRole('link', { name: 'Create an account' }),
    ).toHaveCount(0);

    // Attempt 1 is rejected by policy after consuming the edge-rate bucket.
    const closedResponse = await recipientPage.request.post(
      '/api/auth/sign-up/email',
      { data: { ...body, email: closedEmail }, headers },
    );
    expect(closedResponse.status()).toBe(403);
    assertNoSessionCookies(await setCookieHeaders(closedResponse));
    assertPasswordAbsent(await readJson(closedResponse), password);

    await page.goto(`/${operationalOrganizationSlug}/members`);
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Role').first().selectOption('member');
    await page.getByRole('button', { name: 'Send invitation' }).click();
    await expect(page).toHaveURL(/\/members\?result=success$/);

    const invitationId = await page.evaluate(
      async ({ email: recipient, organizationId }) => {
        const response = await fetch(
          `/api/auth/organization/list-invitations?organizationId=${encodeURIComponent(organizationId)}`,
          { cache: 'no-store' },
        );
        if (!response.ok) return null;
        const body: unknown = await response.json();
        if (!Array.isArray(body)) return null;
        const invitation = body.find(
          (value) =>
            typeof value === 'object' &&
            value !== null &&
            'email' in value &&
            value.email === recipient &&
            'status' in value &&
            value.status === 'pending',
        );
        return typeof invitation === 'object' &&
          invitation !== null &&
          'id' in invitation &&
          typeof invitation.id === 'string'
          ? invitation.id
          : null;
      },
      { email, organizationId: operationalOrganizationId },
    );
    expect(invitationId).not.toBeNull();
    if (invitationId === null) {
      throw new Error('Pending invitation was not available.');
    }

    const invitationRequests: string[] = [];
    recipientPage.on('request', (request) => {
      if (request.url().includes('/organization/get-invitation')) {
        invitationRequests.push(request.url());
      }
    });
    await navigateToSensitivePath(recipientPage, `/invitation/${invitationId}`);
    await expect(
      recipientPage.getByRole('heading', { name: 'Organization invitation' }),
    ).toBeVisible();
    await expect(
      recipientPage.getByText(
        /create an account with that address, verify it, then return/i,
      ),
    ).toBeVisible();
    await expect(
      recipientPage.getByRole('link', { name: 'Sign in' }),
    ).toHaveAttribute('href', '/sign-in');
    const createAccount = recipientPage.getByRole('link', {
      name: 'Create invited account',
    });
    await expect(createAccount).toHaveAttribute('href', '/sign-up');
    if (
      (await recipientPage.locator('body').innerText()).includes(invitationId)
    ) {
      throw new Error('Signed-out invitation guidance exposed its identifier.');
    }
    if (invitationRequests.length !== 0) {
      throw new Error(
        'Signed-out invitation guidance performed a protected lookup.',
      );
    }
    await createAccount.click();
    await expect
      .poll(() => new URL(recipientPage.url()).pathname, {
        message: 'Create-account link did not reach sign-up.',
      })
      .toBe('/sign-up');
    await expect(
      recipientPage.getByText('Account creation requires an invitation.'),
    ).toBeVisible();

    await recipientPage.getByLabel('Full name').fill(body.name);
    await recipientPage.getByLabel('Email address').fill(email);
    await recipientPage.locator('input[name="password"]').fill(password);
    const freshResponsePromise = recipientPage.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/auth/sign-up/email',
    );
    await recipientPage.getByRole('button', { name: 'Create account' }).click();
    const freshResponse = await freshResponsePromise;
    const freshBody = await readJson(freshResponse);
    const freshCookies = await setCookieHeaders(freshResponse);
    expect(freshResponse.status()).toBe(200);
    assertNoSessionCookies(freshCookies);
    assertTokenlessResponse(freshBody, password);
    await expect(recipientPage.getByText('Check your email')).toBeVisible();
    await expect(
      recipientPage.getByRole('form', { name: 'Create your BAP account' }),
    ).toHaveCount(0);
    expect(
      (await recipientContext.cookies()).some((cookie) =>
        /session.?token/i.test(cookie.name),
      ),
    ).toBe(false);

    const freshMessageId = await waitForFreshMessage(email);
    expect(freshMessageId).not.toBe('');

    const unverifiedSignIn = await recipientPage.request.post(
      '/api/auth/sign-in/email',
      { data: { email, password }, headers },
    );
    expect(unverifiedSignIn.status()).toBe(403);
    assertNoSessionCookies(await setCookieHeaders(unverifiedSignIn));
    assertPasswordAbsent(await readJson(unverifiedSignIn), password);

    await setPublicSignup(true);
    await assertSignUpPage(recipientPage, true);
    await recipientPage.goto('/sign-in');
    await expect(
      recipientPage.getByRole('link', { name: 'Create an account' }),
    ).toHaveAttribute('href', '/sign-up');

    // Attempt 3 is the identical duplicate of the invited UI submission.
    const duplicateResponse = await recipientPage.request.post(
      '/api/auth/sign-up/email',
      { data: body, headers },
    );
    const duplicateBody = await readJson(duplicateResponse);
    const duplicateCookies = await setCookieHeaders(duplicateResponse);
    expect(duplicateResponse.status()).toBe(freshResponse.status());
    assertEqualCookies(duplicateCookies, freshCookies);
    assertTokenlessResponse(duplicateBody, password);
    if (
      !isDeepStrictEqual(
        withoutGeneratedIdentityFields(duplicateBody),
        withoutGeneratedIdentityFields(freshBody),
      )
    ) {
      throw new Error('Fresh and duplicate sign-up responses differed.');
    }

    const messageIds = await mailMessageIds(
      email,
      'Confirm your BAP email address',
    );
    if (messageIds.length !== 1 || messageIds[0] !== freshMessageId) {
      throw new Error(
        'Duplicate sign-up changed the verification message set.',
      );
    }
    await expectMessageSetUnchanged(email, [freshMessageId]);

    // Attempt 4 shares the same Caddy-established client bucket and must be limited.
    const limitedResponse = await recipientPage.request.post(
      '/api/auth/sign-up/email',
      { data: { ...body, email: rateLimitedEmail }, headers },
    );
    expect(limitedResponse.status()).toBe(429);
    assertNoSessionCookies(await setCookieHeaders(limitedResponse));
    assertPasswordAbsent(await readJson(limitedResponse), password);
    expect(await mailMessageIds(rateLimitedEmail)).toEqual([]);
    await expectMessageSetUnchanged(rateLimitedEmail, []);

    await setPublicSignup(false);
    verificationRedirect = await startVerificationRedirect(email);
    await navigateToSensitivePath(recipientPage, verificationRedirect.url);
    await expect
      .poll(() => new URL(recipientPage.url()).pathname, {
        message: 'Verification did not reach the welcome page.',
      })
      .toBe('/welcome');
    await expect(
      recipientPage.getByRole('heading', { name: 'Welcome to BAP' }),
    ).toBeVisible();
    await verificationRedirect.completed;
    verificationRedirect = undefined;

    await recipientPage.goto('/access');
    const signedOutPromise = recipientPage.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/auth/sign-out',
    );
    await recipientPage.getByRole('button', { name: 'Sign out' }).click();
    expect((await signedOutPromise).ok()).toBe(true);
    await expect(recipientPage).toHaveURL(/\/sign-in$/);
    await recipientPage.getByLabel('Email address').fill(email);
    await recipientPage.locator('input[name="password"]').fill(password);
    const signedInPromise = recipientPage.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/auth/sign-in/email',
    );
    await recipientPage.getByRole('button', { name: 'Sign in' }).click();
    expect((await signedInPromise).ok()).toBe(true);
    await expect(recipientPage).toHaveURL(/\/access$/);

    await navigateToSensitivePath(recipientPage, `/invitation/${invitationId}`);
    await expect(
      recipientPage.getByText('Organization: BAP Operational'),
    ).toBeVisible();
    await expect(recipientPage.getByText('Role: member')).toBeVisible();
    const accept = recipientPage.getByRole('button', {
      name: 'Accept invitation',
    });
    await expect(accept.locator('svg.cds--btn__icon')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
    const acceptedPromise = recipientPage.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname ===
          '/api/auth/organization/accept-invitation',
    );
    await accept.click();
    expect((await acceptedPromise).ok()).toBe(true);
    await expect
      .poll(() => new URL(recipientPage.url()).pathname, {
        message: 'Invitation acceptance did not reach access.',
      })
      .toBe('/access');
    await expect(
      recipientPage.getByText('Application API role: member'),
    ).toBeVisible();

    await page.goto(`/${operationalOrganizationSlug}/members`);
    let member = page
      .locator('section[aria-labelledby="members-heading"] p')
      .filter({ hasText: /, member$/ })
      .locator('..');
    await expect(member).toHaveCount(1);
    const roleForm = member.getByRole('form', { name: /^Change role for / });
    await roleForm.getByLabel('Role').selectOption('admin');
    await roleForm.getByRole('button', { name: 'Change role' }).click();
    await expect(page).toHaveURL(/\/members\?result=success$/);
    member = page
      .locator('section[aria-labelledby="members-heading"] p')
      .filter({ hasText: /, admin$/ })
      .locator('..');
    await expect(member).toHaveCount(1);

    await member
      .getByRole('form', { name: /^Remove / })
      .getByRole('button', { name: 'Remove member' })
      .click();
    await expect(page).toHaveURL(/\/members\?result=success$/);
    await expect(
      page
        .locator('section[aria-labelledby="members-heading"] p')
        .filter({ hasText: /, admin$/ }),
    ).toHaveCount(0);
  } finally {
    await verificationRedirect?.stop();
    await recipientContext.close();
    await setPublicSignup(false);
  }
});
