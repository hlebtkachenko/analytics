// @vitest-environment node

import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import {
  normalizeOrganizationSlug,
  organizationSlugSchema,
  reservedOrganizationSlugs,
} from './slug.js';

type SlugCase = Readonly<{ slug: string; valid: boolean }>;

async function readSlugCorpus(): Promise<SlugCase[]> {
  return JSON.parse(
    await readFile(
      new URL(
        '../../../../../tests/fixtures/organization-slugs.json',
        import.meta.url,
      ),
      'utf8',
    ),
  ) as SlugCase[];
}

describe('organization slugs', () => {
  it('exports only the approved literal reserved routes', () => {
    expect(reservedOrganizationSlugs).toEqual([
      'access',
      'api',
      'datasets',
      'design-system',
      'health',
      'invitation',
      'metrics',
      'ready',
      'sign-in',
      'sign-up',
      'forgot-password',
      'reset-password',
      'activate',
      'welcome',
      'account',
      'organizations',
    ]);
  });

  it('matches the shared database parity corpus', async () => {
    for (const testCase of await readSlugCorpus()) {
      expect(
        organizationSlugSchema.safeParse(testCase.slug).success,
        testCase.slug,
      ).toBe(testCase.valid);
    }
  });

  it('enumerates every reserved route in the shared database parity corpus', async () => {
    const rejectedSlugs = new Set(
      (await readSlugCorpus())
        .filter((testCase) => !testCase.valid)
        .map((testCase) => testCase.slug),
    );

    expect(
      reservedOrganizationSlugs.every((slug) => rejectedSlugs.has(slug)),
    ).toBe(true);
  });

  it.each([
    ['  Alpha Organization  ', 'alpha-organization'],
    ['alpha___beta', 'alpha-beta'],
    ['--alpha---beta--', 'alpha-beta'],
    ['A very long organization name', 'a-very-long-organiza'],
    ['alpha-beta-gamma---', 'alpha-beta-gamma'],
  ])('normalizes %j deterministically', (input, expected) => {
    expect(normalizeOrganizationSlug(input)).toBe(expected);
  });

  it.each(['access', 'organizations', '12345', 'a', '---'])(
    'keeps %j as an invalid candidate instead of silently renaming it',
    (input) => {
      const normalized = normalizeOrganizationSlug(input);
      expect(organizationSlugSchema.safeParse(normalized).success).toBe(false);
    },
  );
});
