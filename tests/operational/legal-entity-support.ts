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

// The documents pages scope by a "Legal entity" MultiSelect with several checkable options.
export async function selectMultiSelectLegalEntities(
  page: Page,
  names: readonly string[],
): Promise<void> {
  const field = page.getByRole('combobox', { name: 'Legal entity' });
  await expect(field).toBeVisible();
  await field.click();
  for (const name of names) {
    await page.getByRole('option', { exact: true, name }).click();
  }
  // The fixed selection keeps the menu open, so it is closed by hand once every name is checked.
  await page.keyboard.press('Escape');
}

// The selection renders as a count tag whose clear control drops every scoped entity at once.
export async function clearLegalEntities(page: Page): Promise<void> {
  const clear = page.getByRole('button', { name: /Clear selected item/ });
  await expect(clear).toBeVisible();
  await clear.click();
}

type LegalEntityList = Readonly<{
  legalEntities: ReadonlyArray<Readonly<{ id: string; name: string }>>;
}>;

type PartnerList = Readonly<{
  partners: ReadonlyArray<Readonly<{ id: string; name: string }>>;
}>;

// The entity is created through the real owner UI, then its identifier is read back from the register.
export async function resolveLegalEntityId(
  page: Page,
  legalEntitiesPath: string,
  entityName: string,
): Promise<string> {
  const listed = await page.request.get(legalEntitiesPath);
  expect(listed.status()).toBe(200);
  const body = (await listed.json()) as LegalEntityList;
  const found = body.legalEntities.find((entity) => entity.name === entityName);
  expect(found, 'The demo legal entity is missing.').toBeDefined();
  return found!.id;
}

// A registration number is unique per organization, so an earlier run's partner is reused rather than duplicated.
export async function ensurePartner(
  page: Page,
  partner: Readonly<{
    partnersPath: string;
    name: string;
    registrationNumber: string;
    legalEntityId: string;
  }>,
): Promise<string> {
  const listed = await page.request.get(
    `${partner.partnersPath}?q=${encodeURIComponent(partner.name)}`,
  );
  expect(listed.status()).toBe(200);
  const existing = ((await listed.json()) as PartnerList).partners.find(
    (found) => found.name === partner.name,
  );
  if (existing !== undefined) {
    return existing.id;
  }

  const created = await page.request.post(partner.partnersPath, {
    data: {
      countryCode: 'CZ',
      legalEntityId: partner.legalEntityId,
      name: partner.name,
      registrationNumber: partner.registrationNumber,
    },
  });
  expect(created.status(), 'The demo partner was refused.').toBe(201);
  return ((await created.json()) as Readonly<{ id: string }>).id;
}
