'use server';

import { z } from 'zod';

import { entityScopeSchema, subjectIdSchema } from '../auth/bff';
import { formValue, runScopedAction } from './action-support';
import { writeMemberEntityScope } from './entities';

const MEMBERS_SECTION = '/members';

const memberEntityScopeSchema = z
  .object({ entityScope: entityScopeSchema, userId: subjectIdSchema })
  .strict();

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
