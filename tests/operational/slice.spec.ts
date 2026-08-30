import { expect, test } from '@playwright/test';

const email = process.env.BAP_OPERATIONAL_EMAIL ?? 'owner@bap.invalid';
const organizationId =
  process.env.BAP_OPERATIONAL_ORGANIZATION_ID ?? 'bap-operational';
const password = process.env.BAP_OPERATIONAL_PASSWORD ?? '';

// A synthetic fixture with no meaning: one text column, one numeric column, five rows.
const fixture = `${[
  'label,value',
  'alpha,10',
  'beta,20',
  'gamma,30',
  'delta,40',
  'epsilon,50',
].join('\n')}\n`;

// The worker names the dataset after the uploaded file, so a per-run name keeps the row unambiguous.
const fixtureName = `operational-slice-${Date.now()}.csv`;

type DatasetList = Readonly<{
  datasets: ReadonlyArray<Readonly<{ name: string; status: string }>>;
}>;

test('imports an uploaded CSV and renders its rows and chart', async ({
  page,
}) => {
  test.skip(password.length === 0, 'BAP_OPERATIONAL_PASSWORD is required.');
  // Ingestion runs on a polled queue, so this slice needs more than the shared budget.
  test.setTimeout(60_000);
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });

  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.locator('input[name="password"]').fill(password);
  const signedIn = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().includes('/api/auth/sign-in/email'),
  );
  await page.getByRole('button', { name: 'Sign in' }).click();
  expect((await signedIn).ok()).toBe(true);

  await page.goto('/datasets');
  await expect(
    page.getByRole('heading', { exact: true, name: 'Datasets' }),
  ).toBeVisible();
  // The uploader is offered only once the access contract grants the upload capability.
  const chooser = page.locator('input[name="file"]');
  await expect(chooser).toBeAttached();
  await chooser.setInputFiles({
    buffer: Buffer.from(fixture, 'utf8'),
    mimeType: 'text/csv',
    name: fixtureName,
  });

  const uploaded = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().includes(`/organizations/${organizationId}/uploads`),
  );
  await page.getByRole('button', { name: 'Upload data' }).click();
  expect((await uploaded).status()).toBe(202);
  await expect(
    page.getByText('The file was accepted and is being imported.'),
  ).toBeVisible();

  // The upload response only means accepted, so the ready status the worker writes is the real condition.
  await expect
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

  // The list is fetched once per visit, so the ready dataset is read on a fresh load.
  await page.reload();
  const listedRow = page.getByRole('row').filter({ hasText: fixtureName });
  await expect(listedRow).toBeVisible();
  await expect(
    listedRow.getByRole('cell', { name: 'Ready', exact: true }),
  ).toBeVisible();
  await expect(
    listedRow.getByRole('cell', { name: '5', exact: true }),
  ).toBeVisible();

  await page.getByRole('button', { name: `Open ${fixtureName}` }).click();
  const rows = page.getByRole('table', { name: 'Dataset rows' });
  await expect(rows).toBeVisible();
  await expect(rows.getByRole('columnheader', { name: 'label' })).toBeVisible();
  await expect(rows.getByRole('columnheader', { name: 'value' })).toBeVisible();
  await expect(
    rows.getByRole('cell', { name: 'alpha', exact: true }),
  ).toBeVisible();
  await expect(
    rows.getByRole('cell', { name: 'epsilon', exact: true }),
  ).toBeVisible();
  await expect(rows.getByRole('row')).toHaveCount(6);

  const chart = page.getByRole('img', {
    name: 'Bar chart of the first numeric column.',
  });
  await expect(chart).toBeVisible();
  await expect(chart.locator('rect')).toHaveCount(5);
  const charted = page.getByRole('table', { name: 'Charted values' });
  await expect(
    charted.getByRole('cell', { name: 'alpha', exact: true }),
  ).toBeVisible();
  await expect(
    charted.getByRole('cell', { name: '10', exact: true }),
  ).toBeVisible();

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
  expect(consoleErrors).toEqual([]);
});
