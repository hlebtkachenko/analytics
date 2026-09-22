import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

export type LegalEntityKind = 'company' | 'sole_trader';

// Creates the named legal entity through the real Carbon owner UI, and does nothing when it is already there.
export async function ensureLegalEntity(
  page: Page,
  organizationSlug: string,
  name: string,
  kind: LegalEntityKind = 'company',
): Promise<void> {
  await page.goto(`/${organizationSlug}/entities`);
  const stored = page.getByRole('cell', { exact: true, name });

  if ((await stored.count()) > 0) {
    return;
  }

  await page.getByRole('button', { name: 'Add legal entity' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add legal entity' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Name').fill(name);
  await dialog.getByLabel('Kind').selectOption(kind);
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('The legal entity was created.')).toBeVisible();
  await expect(stored).toBeVisible();
}

// Every upload belongs to exactly one legal entity, so the uploader must pick one first.
export async function selectUploadLegalEntity(
  page: Page,
  name: string,
): Promise<void> {
  const selector = page.getByLabel('Legal entity', { exact: true });
  await expect(selector).toBeVisible();
  await selector.selectOption({ label: name });
}
