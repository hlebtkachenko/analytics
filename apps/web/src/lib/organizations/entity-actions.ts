'use server';

import type { Route } from 'next';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import {
  formValue,
  invalidScopedActionPath,
  organizationPath,
  resolveActionOrganization,
  resultPath,
} from './action-support';
import {
  createLegalEntity,
  removeLegalEntity,
  updateLegalEntity,
  writeMemberEntityScope,
} from './entities';
import { organizationSlugSchema } from './slug';

const legalEntityIdSchema = z.string().uuid();
const legalEntityKindSchema = z.enum(['company', 'sole_trader']);
const legalEntityBodySchema = z.object({
  kind: legalEntityKindSchema,
  name: z.string().trim().min(1).max(200),
  // The same bound and alphabet the shared contract and the database enforce.
  registrationNumber: z
    .string()
    .trim()
    .min(1)
    .max(32)
    .regex(/^[A-Za-z0-9-]+$/)
    .optional(),
});
const legalEntityUpdateSchema = legalEntityBodySchema.extend({
  legalEntityId: legalEntityIdSchema,
});
const legalEntityRemovalSchema = z.object({
  legalEntityId: legalEntityIdSchema,
});
const memberEntityScopeSchema = z.object({
  legalEntityIds: z.array(legalEntityIdSchema).max(200),
  mode: z.enum(['all', 'restricted']),
  // Better Auth mints opaque text user ids, so the bound is a shape, not a UUID.
  userId: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9_-]+$/),
});

// An empty optional field is an omission, never an empty registration number.
function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function checkedIds(formData: FormData): string[] {
  return formData
    .getAll('legalEntityIds')
    .filter((value): value is string => typeof value === 'string');
}

function entitiesPath(slug: string): string {
  return organizationPath(slug, '/entities');
}

function membersPath(slug: string): string {
  return organizationPath(slug, '/members');
}

export async function createLegalEntityAction(
  organizationSlug: string,
  formData: FormData,
): Promise<never> {
  const routeSlug = organizationSlugSchema.safeParse(organizationSlug);
  if (!routeSlug.success) {
    return redirect(invalidScopedActionPath as Route);
  }

  const input = legalEntityBodySchema.safeParse({
    kind: formValue(formData, 'kind'),
    name: formValue(formData, 'name'),
    registrationNumber: optionalText(formValue(formData, 'registrationNumber')),
  });
  let fallback = resultPath(entitiesPath(routeSlug.data), 'error');
  let destination = fallback;

  if (input.success) {
    try {
      const organization = await resolveActionOrganization(routeSlug.data);
      fallback = resultPath(entitiesPath(organization.slug), 'error');
      destination = fallback;

      if (!(await createLegalEntity(organization.id, input.data))) {
        throw new Error('Legal entity creation unavailable.');
      }

      revalidatePath(entitiesPath(organization.slug));
      destination = resultPath(entitiesPath(organization.slug), 'success');
    } catch {
      destination = fallback;
    }
  }

  redirect(destination as Route);
}

export async function updateLegalEntityAction(
  organizationSlug: string,
  formData: FormData,
): Promise<never> {
  const routeSlug = organizationSlugSchema.safeParse(organizationSlug);
  if (!routeSlug.success) {
    return redirect(invalidScopedActionPath as Route);
  }

  const input = legalEntityUpdateSchema.safeParse({
    kind: formValue(formData, 'kind'),
    legalEntityId: formValue(formData, 'legalEntityId'),
    name: formValue(formData, 'name'),
    registrationNumber: optionalText(formValue(formData, 'registrationNumber')),
  });
  let fallback = resultPath(entitiesPath(routeSlug.data), 'error');
  let destination = fallback;

  if (input.success) {
    const { legalEntityId, ...body } = input.data;
    try {
      const organization = await resolveActionOrganization(routeSlug.data);
      fallback = resultPath(entitiesPath(organization.slug), 'error');
      destination = fallback;

      if (!(await updateLegalEntity(organization.id, legalEntityId, body))) {
        throw new Error('Legal entity update unavailable.');
      }

      revalidatePath(entitiesPath(organization.slug));
      destination = resultPath(entitiesPath(organization.slug), 'success');
    } catch {
      destination = fallback;
    }
  }

  redirect(destination as Route);
}

export async function deleteLegalEntityAction(
  organizationSlug: string,
  formData: FormData,
): Promise<never> {
  const routeSlug = organizationSlugSchema.safeParse(organizationSlug);
  if (!routeSlug.success) {
    return redirect(invalidScopedActionPath as Route);
  }

  const input = legalEntityRemovalSchema.safeParse({
    legalEntityId: formValue(formData, 'legalEntityId'),
  });
  let fallback = resultPath(entitiesPath(routeSlug.data), 'error');
  let destination = fallback;

  if (input.success) {
    try {
      const organization = await resolveActionOrganization(routeSlug.data);
      fallback = resultPath(entitiesPath(organization.slug), 'error');
      destination = fallback;

      if (
        !(await removeLegalEntity(organization.id, input.data.legalEntityId))
      ) {
        throw new Error('Legal entity removal unavailable.');
      }

      revalidatePath(entitiesPath(organization.slug));
      destination = resultPath(entitiesPath(organization.slug), 'success');
    } catch {
      destination = fallback;
    }
  }

  redirect(destination as Route);
}

export async function updateMemberEntityScopeAction(
  organizationSlug: string,
  formData: FormData,
): Promise<never> {
  const routeSlug = organizationSlugSchema.safeParse(organizationSlug);
  if (!routeSlug.success) {
    return redirect(invalidScopedActionPath as Route);
  }

  const input = memberEntityScopeSchema.safeParse({
    legalEntityIds: checkedIds(formData),
    mode: formValue(formData, 'mode'),
    userId: formValue(formData, 'userId'),
  });
  let fallback = resultPath(membersPath(routeSlug.data), 'error');
  let destination = fallback;

  if (input.success) {
    const scope =
      input.data.mode === 'all'
        ? ({ mode: 'all' } as const)
        : ({
            legalEntityIds: input.data.legalEntityIds,
            mode: 'restricted',
          } as const);
    try {
      // Entity access belongs to the owner alone, so a non-owner never reaches the API.
      const organization = await resolveActionOrganization(
        routeSlug.data,
        'owner',
      );
      fallback = resultPath(membersPath(organization.slug), 'error');
      destination = fallback;

      if (
        !(await writeMemberEntityScope(
          organization.id,
          input.data.userId,
          scope,
        ))
      ) {
        throw new Error('Member entity scope unavailable.');
      }

      revalidatePath(membersPath(organization.slug));
      destination = resultPath(membersPath(organization.slug), 'success');
    } catch {
      destination = fallback;
    }
  }

  redirect(destination as Route);
}
