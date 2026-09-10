import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

export type LegalEntityKind = 'company' | 'sole_trader';

// Creates the named legal entity through the real owner UI, and does nothing when it is already there.
export async function ensureLegalEntity(
  page: Page,
  organizationSlug: string,
  name: string,
  kind: LegalEntityKind = 'company',
): Promise<void> {
  await page.goto(`/${organizationSlug}/entities`);
  const stored = page.getByRole('form', { name: `Edit ${name}` });

  if ((await stored.count()) > 0) {
    return;
  }

  const form = page.getByRole('form', { name: 'Add legal entity' });
  await expect(form).toBeVisible();
  await form.getByLabel('Name').fill(name);
  await form.getByLabel('Kind').selectOption(kind);
  await form.getByRole('button', { name: 'Add entity' }).click();
  await expect(page).toHaveURL(
    new RegExp(`/${organizationSlug}/entities\\?result=success$`),
  );
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
