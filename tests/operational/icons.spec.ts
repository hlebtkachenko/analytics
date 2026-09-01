import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import { expect, test as publicTest } from '@playwright/test';
import type { Browser, Locator, Page } from '@playwright/test';
import axe from 'axe-core';

import { expect as authenticatedExpect, test } from './authenticated-test';

const baseURL =
  process.env.BAP_OPERATIONAL_BASE_URL ?? 'http://localhost:39100';
const organizationId =
  process.env.BAP_OPERATIONAL_ORGANIZATION_ID ?? 'bap-operational';
const organizationSlug =
  process.env.BAP_OPERATIONAL_ORGANIZATION_SLUG ?? 'bap-operational';
const password = process.env.BAP_OPERATIONAL_PASSWORD ?? '';

const fixture = `${[
  'label,value',
  ...Array.from(
    { length: 30 },
    (_, index) => `row-${String(index + 1)},${String(index + 1)}`,
  ),
].join('\n')}\n`;
const fixtureName = `operational-icons-${Date.now()}.csv`;

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

type DatasetList = Readonly<{
  datasets: ReadonlyArray<Readonly<{ name: string; status: string }>>;
}>;

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

async function runDocker(
  command: readonly string[],
  input?: string,
): Promise<string> {
  return await new Promise((resolve, reject) => {
    const child = spawn('docker', composeArguments(command), {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill();
        reject(new Error('Operational fixture command timed out.'));
      }
    }, 30_000);

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.once('error', () => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(new Error('Operational fixture command could not start.'));
      }
    });
    child.once('close', (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error('Operational fixture command failed.'));
        }
      }
    });
    child.stdin.end(input);
  });
}

async function setPublicSignup(enabled: boolean): Promise<void> {
  const stdout = await runDocker([
    'run',
    '--rm',
    '--no-deps',
    'migrator',
    'node',
    'node_modules/@bap/db/dist/cli.js',
    'signup',
    enabled ? 'enable' : 'disable',
  ]);
  const result: unknown = JSON.parse(stdout);

  if (
    typeof result !== 'object' ||
    result === null ||
    !('publicSignupEnabled' in result) ||
    result.publicSignupEnabled !== enabled
  ) {
    throw new Error('Unexpected public sign-up state.');
  }
}

async function expectNoAccessibilityViolations(page: Page): Promise<void> {
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

async function expectNoDocumentOverflow(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
}

async function expectIconControl(
  control: Locator,
  accessibleName: string,
): Promise<void> {
  await expect(control).toBeVisible();
  await expect(control).toHaveAccessibleName(accessibleName);
  const visibleLabel = (await control.innerText())
    .replaceAll(/\s+/g, ' ')
    .trim();
  expect(visibleLabel).not.toBe('');
  expect(accessibleName.toLowerCase()).toContain(visibleLabel.toLowerCase());

  const icon = control.locator('svg.cds--btn__icon');
  await expect(icon).toHaveCount(1);
  await expect(icon).toHaveAttribute('aria-hidden', 'true');
  await expect(icon).toHaveAttribute('fill', 'currentColor');
  await expect(icon).toHaveAttribute('height', '16');
  await expect(icon).toHaveAttribute('width', '16');
  await expect(icon).not.toHaveAttribute('aria-label', /.+/);
  await expect(icon).not.toHaveAttribute('focusable', 'true');
  await expect(icon).not.toHaveAttribute('tabindex', /.+/);

  const geometry = await control.evaluate((element) => {
    const glyph = element.querySelector<SVGElement>('svg.cds--btn__icon');
    if (!glyph) {
      throw new Error('Icon glyph is missing.');
    }
    const controlRect = element.getBoundingClientRect();
    const iconRect = glyph.getBoundingClientRect();
    return {
      controlHeight: controlRect.height,
      controlWidth: controlRect.width,
      iconHeight: iconRect.height,
      iconTabIndex: glyph.tabIndex,
      iconWidth: iconRect.width,
      verticalOffset: Math.abs(
        controlRect.top +
          controlRect.height / 2 -
          (iconRect.top + iconRect.height / 2),
      ),
    };
  });
  expect(geometry.controlHeight).toBeGreaterThanOrEqual(44);
  expect(geometry.controlWidth).toBeGreaterThanOrEqual(44);
  expect(geometry.iconHeight).toBe(16);
  expect(geometry.iconWidth).toBe(16);
  expect(geometry.iconTabIndex).toBe(-1);
  expect(geometry.verticalOffset).toBeLessThanOrEqual(1);
  expect(
    await icon.evaluate((element) => element === document.activeElement),
  ).toBe(false);
}

async function focusWithKeyboard(page: Page, control: Locator): Promise<void> {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });

  for (let index = 0; index < 20; index += 1) {
    await page.keyboard.press('Tab');
    if (
      await control.evaluate((element) => element === document.activeElement)
    ) {
      return;
    }
  }

  throw new Error('Keyboard navigation did not reach the icon control.');
}

function monitorPage(page: Page): Readonly<{
  consoleErrors: string[];
  pageErrors: string[];
}> {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  return { consoleErrors, pageErrors };
}

async function signIn(
  page: Page,
  email: string,
  secret: string,
): Promise<void> {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.locator('input[name="password"]').fill(secret);
  const signedIn = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().includes('/api/auth/sign-in/email'),
  );
  await page.getByRole('button', { name: 'Sign in' }).click();
  expect((await signedIn).ok()).toBe(true);
}

async function createInvitationRecipient(): Promise<
  Readonly<{
    email: string;
    password: string;
  }>
> {
  const suffix = randomUUID();
  const email = `icon-recipient-${suffix}@example.test`;
  const recipientPassword = `Operational-${randomUUID()}`;
  const input = JSON.stringify({
    email,
    name: 'Icon Recipient',
    organizationName: `Icon Recipient ${suffix}`,
    organizationSlug: `icon-recipient-${suffix}`,
    password: recipientPassword,
  });
  const stdout = await runDocker(
    [
      '--profile',
      'bootstrap',
      'run',
      '--rm',
      '--no-deps',
      '-T',
      '-e',
      'BAP_E2E_SETUP=true',
      'bootstrap-owner',
      'node',
      'apps/web/dist-cli/cli/create-synthetic-account.js',
    ],
    input,
  );
  const result: unknown = JSON.parse(stdout);

  if (
    typeof result !== 'object' ||
    result === null ||
    !('status' in result) ||
    result.status !== 'created'
  ) {
    throw new Error('Synthetic invitation recipient was not created.');
  }

  return { email, password: recipientPassword };
}

async function verifyInvitationControl(
  browser: Browser,
  invitationId: string,
  recipient: Readonly<{ email: string; password: string }>,
): Promise<void> {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  const errors = monitorPage(page);

  try {
    await signIn(page, recipient.email, recipient.password);
    await page.goto(`/invitation/${invitationId}`);
    const accept = page.getByRole('button', { name: 'Accept invitation' });
    await expectIconControl(accept, 'Accept invitation');
    await focusWithKeyboard(page, accept);
    await expectNoAccessibilityViolations(page);
    expect(errors.consoleErrors).toEqual([]);
    expect(errors.pageErrors).toEqual([]);
  } finally {
    await context.close();
  }
}

publicTest(
  'proves real public Carbon icon controls and 640px layout-equivalent reflow',
  async ({ page }) => {
    publicTest.setTimeout(60_000);
    const errors = monitorPage(page);
    await page.setViewportSize({ height: 900, width: 640 });

    await page.goto('/sign-in');
    const signInButton = page.getByRole('button', { name: 'Sign in' });
    await expectIconControl(signInButton, 'Sign in');
    await focusWithKeyboard(page, signInButton);
    await expectNoAccessibilityViolations(page);
    await expectNoDocumentOverflow(page);

    await page.goto('/forgot-password');
    await expectIconControl(
      page.getByRole('button', { name: 'Send reset link' }),
      'Send reset link',
    );

    await page.goto('/sign-in/two-factor');
    await expectIconControl(
      page.getByRole('button', { name: 'Verify' }),
      'Verify',
    );

    await page.goto('/reset-password?token=ResetSentinelTokenAbc123');
    await expect(page).toHaveURL(/\/reset-password$/);
    await expectIconControl(
      page.getByRole('button', { name: 'Update password' }),
      'Update password',
    );

    await page.goto('/design-system');
    await expectIconControl(
      page.getByRole('link', { name: 'Open Carbon React documentation' }),
      'Open Carbon React documentation',
    );

    try {
      await setPublicSignup(true);
      await page.goto('/sign-up');
      await expectIconControl(
        page.getByRole('button', { name: 'Create account' }),
        'Create account',
      );
    } finally {
      await setPublicSignup(false);
    }

    await expectNoAccessibilityViolations(page);
    await expectNoDocumentOverflow(page);
    expect(errors.consoleErrors).toEqual([]);
    expect(errors.pageErrors).toEqual([]);
  },
);

test('proves every real authenticated icon control and Phase 10 exclusion', async ({
  browser,
  page,
}) => {
  test.skip(password.length === 0, 'BAP_OPERATIONAL_PASSWORD is required.');
  test.setTimeout(90_000);
  const errors = monitorPage(page);
  await page.setViewportSize({ height: 900, width: 640 });

  await page.goto('/access');
  const organization = page.getByLabel('Organization');
  await authenticatedExpect(organization).toBeVisible();
  await organization.selectOption(organizationId);
  await authenticatedExpect(
    page.getByText('Application API role: owner'),
  ).toBeVisible();

  for (const [role, label] of [
    ['button', 'Sign out'],
    ['link', 'Open datasets'],
    ['button', 'Manage members'],
    ['button', 'Manage data grants'],
    ['button', 'Upload data'],
    ['button', 'Ask the assistant'],
  ] as const) {
    await expectIconControl(page.getByRole(role, { name: label }), label);
  }
  await focusWithKeyboard(page, page.getByRole('button', { name: 'Sign out' }));
  await expectNoAccessibilityViolations(page);
  await expectNoDocumentOverflow(page);

  await page.goto('/datasets');
  const datasetOrganization = page.getByLabel('Organization');
  await authenticatedExpect(datasetOrganization).toBeVisible();
  await datasetOrganization.selectOption(organizationId);
  const chooser = page.locator('input[name="file"]');
  await authenticatedExpect(chooser).toBeAttached();
  await chooser.setInputFiles({
    buffer: Buffer.from(fixture, 'utf8'),
    mimeType: 'text/csv',
    name: fixtureName,
  });
  const uploadButton = page.getByRole('button', { name: 'Upload data' });
  await expectIconControl(uploadButton, 'Upload data');
  const uploaded = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().includes(`/organizations/${organizationId}/uploads`),
  );
  await uploadButton.click();
  expect((await uploaded).status()).toBe(202);

  await authenticatedExpect
    .poll(
      async () => {
        const listed = await page.request.get(
          `/api/bff/application/organizations/${organizationId}/datasets`,
        );
        if (!listed.ok()) {
          return `http_${listed.status()}`;
        }
        const body = (await listed.json()) as DatasetList;
        return (
          body.datasets.find((dataset) => dataset.name === fixtureName)
            ?.status ?? 'absent'
        );
      },
      { intervals: [1_000], timeout: 30_000 },
    )
    .toBe('ready');

  await page.reload();
  const row = page.getByRole('row').filter({ hasText: fixtureName });
  const open = row.getByRole('button', { name: `Open ${fixtureName}` });
  await expectIconControl(open, `Open ${fixtureName}`);
  await open.click();
  await authenticatedExpect(
    page.getByRole('table', { name: 'Dataset rows' }),
  ).toBeVisible();

  for (const label of [
    'Close dataset',
    'Previous page',
    'Next page',
    'Download CSV',
    'Download XLSX',
    'Send',
  ]) {
    await expectIconControl(page.getByRole('button', { name: label }), label);
  }
  await page.getByRole('button', { name: 'Next page' }).click();
  await authenticatedExpect(page.getByText('Page 2')).toBeVisible();
  await page.getByRole('button', { name: 'Previous page' }).click();
  await authenticatedExpect(page.getByText('Page 1')).toBeVisible();
  await expectNoAccessibilityViolations(page);
  await expectNoDocumentOverflow(page);

  const recipient = await createInvitationRecipient();
  const invitation = await page.evaluate(
    async ({ email, organizationId: targetOrganizationId }) => {
      const response = await fetch('/api/auth/organization/invite-member', {
        body: JSON.stringify({
          email,
          organizationId: targetOrganizationId,
          role: 'member',
        }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });
      const body: unknown = await response.json();
      return { body, status: response.status };
    },
    { email: recipient.email, organizationId },
  );
  authenticatedExpect(invitation.status).toBe(200);
  authenticatedExpect(invitation.body).toEqual(
    authenticatedExpect.objectContaining({
      id: authenticatedExpect.any(String),
    }),
  );
  await verifyInvitationControl(
    browser,
    (invitation.body as { id: string }).id,
    recipient,
  );

  for (const route of [
    '/organizations',
    '/organizations/new',
    `/${organizationSlug}`,
    `/${organizationSlug}/members`,
    `/${organizationSlug}/settings`,
  ]) {
    await page.goto(route);
    await authenticatedExpect(page.locator('main')).toHaveCount(1);
    await authenticatedExpect(page.locator('svg.cds--btn__icon')).toHaveCount(
      0,
    );
    await authenticatedExpect(page.locator('[class*="cds--"]')).toHaveCount(0);
    await expectNoAccessibilityViolations(page);
    await expectNoDocumentOverflow(page);
  }

  expect(errors.consoleErrors).toEqual([]);
  expect(errors.pageErrors).toEqual([]);
});
