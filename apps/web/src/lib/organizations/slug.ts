import { z } from 'zod';

export const reservedOrganizationSlugs = [
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
] as const;

const reservedOrganizationSlugSet = new Set<string>(reservedOrganizationSlugs);

export const organizationSlugSchema = z
  .string()
  .min(3)
  .max(20)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .refine((slug) => !/^\d+$/.test(slug))
  .refine((slug) => !reservedOrganizationSlugSet.has(slug));

export function normalizeOrganizationSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 20)
    .replace(/-+$/g, '');
}
