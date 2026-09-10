'use server';

import { z } from 'zod';

import {
  entityScopeSchema,
  legalEntityCreateBodySchema,
  legalEntityIdSchema,
  legalEntityUpdateBodySchema,
  subjectIdSchema,
} from '../auth/bff';
import { formValue, runScopedAction } from './action-support';
import {
  createLegalEntity,
  removeLegalEntity,
  updateLegalEntity,
  writeMemberEntityScope,
} from './entities';

const ENTITIES_SECTION = '/entities';
const MEMBERS_SECTION = '/members';

const legalEntityUpdateSchema = z
  .object({
    body: legalEntityUpdateBodySchema,
    legalEntityId: legalEntityIdSchema,
  })
  .strict();
const legalEntityRemovalSchema = z
  .object({ legalEntityId: legalEntityIdSchema })
  .strict();
const memberEntityScopeSchema = z
  .object({ entityScope: entityScopeSchema, userId: subjectIdSchema })
  .strict();

// An empty optional field is an omission on creation, never an empty registration number.
function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined;
}

// An empty field on an update clears the stored registration number.
function clearableText(value: unknown): string | null {
  return optionalText(value) ?? null;
}

function checkedIds(formData: FormData): string[] {
  return formData
    .getAll('legalEntityIds')
    .filter((value): value is string => typeof value === 'string');
}

// The submitted scope is shaped here and validated against the shared contract.
function submittedScope(formData: FormData): unknown {
  const mode = formValue(formData, 'mode');

  return mode === 'restricted'
    ? { legalEntityIds: checkedIds(formData), mode }
    : { mode };
}

export async function createLegalEntityAction(
  organizationSlug: string,
  formData: FormData,
): Promise<never> {
  return runScopedAction({
    input: legalEntityCreateBodySchema.safeParse({
      kind: formValue(formData, 'kind'),
      name: formValue(formData, 'name'),
      registrationNumber: optionalText(
        formValue(formData, 'registrationNumber'),
      ),
    }),
    organizationSlug,
    section: ENTITIES_SECTION,
    write: async (organization, body) =>
      await createLegalEntity(organization.id, body),
  });
}

export async function updateLegalEntityAction(
  organizationSlug: string,
  formData: FormData,
): Promise<never> {
  return runScopedAction({
    input: legalEntityUpdateSchema.safeParse({
      body: {
        kind: formValue(formData, 'kind'),
        name: formValue(formData, 'name'),
        registrationNumber: clearableText(
          formValue(formData, 'registrationNumber'),
        ),
      },
      legalEntityId: formValue(formData, 'legalEntityId'),
    }),
    organizationSlug,
    section: ENTITIES_SECTION,
    write: async (organization, input) =>
      await updateLegalEntity(organization.id, input.legalEntityId, input.body),
  });
}

export async function deleteLegalEntityAction(
  organizationSlug: string,
  formData: FormData,
): Promise<never> {
  return runScopedAction({
    input: legalEntityRemovalSchema.safeParse({
      legalEntityId: formValue(formData, 'legalEntityId'),
    }),
    organizationSlug,
    section: ENTITIES_SECTION,
    write: async (organization, input) =>
      await removeLegalEntity(organization.id, input.legalEntityId),
  });
}

export async function updateMemberEntityScopeAction(
  organizationSlug: string,
  formData: FormData,
): Promise<never> {
  return runScopedAction({
    input: memberEntityScopeSchema.safeParse({
      entityScope: submittedScope(formData),
      userId: formValue(formData, 'userId'),
    }),
    organizationSlug,
    // Entity access belongs to the owner alone, so a non-owner never reaches the API.
    requiredRole: 'owner',
    section: MEMBERS_SECTION,
    write: async (organization, input) =>
      await writeMemberEntityScope(
        organization.id,
        input.userId,
        input.entityScope,
      ),
  });
}
