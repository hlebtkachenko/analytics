'use server';

import { headers } from 'next/headers';
import type { Route } from 'next';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { getOrganizationCreationQuota } from '@bap/db/access';

import { getAuth, getAuthPool } from '../auth/server';
import { formValue, organizationPath, resultPath } from './action-support';
import { normalizeOrganizationSlug, organizationSlugSchema } from './slug';

const invitationInputIdSchema = z.object({ invitationId: z.string().min(1) });

// Better Auth answers a slug collision with this code, the only failure the create page names.
function isSlugTakenError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'body' in error &&
    typeof (error as { body?: unknown }).body === 'object' &&
    (error as { body?: { code?: unknown } }).body?.code ===
      'ORGANIZATION_ALREADY_EXISTS'
  );
}

const organizationNameSchema = z.string().trim().min(1);
const createOrganizationInputSchema = z.object({
  name: organizationNameSchema,
  slug: z.string(),
});

export async function createOrganizationAction(
  formData: FormData,
): Promise<never> {
  const input = createOrganizationInputSchema.safeParse({
    name: formValue(formData, 'name'),
    slug: formValue(formData, 'slug'),
  });
  let destination = resultPath('/organizations/new', 'error');

  if (input.success) {
    const slug = organizationSlugSchema.safeParse(
      normalizeOrganizationSlug(input.data.slug),
    );
    if (slug.success) {
      try {
        const auth = await getAuth();
        const requestHeaders = await headers();
        const session = await auth.api.getSession({ headers: requestHeaders });
        if (session?.user.emailVerified !== true) {
          throw new Error('Organization creation unavailable.');
        }
        const quota = await getOrganizationCreationQuota(
          await getAuthPool(),
          session.user.id,
        );
        if (quota !== null && quota.remainingTotal === 0) {
          destination = resultPath('/organizations/new', 'quota-exhausted');
        } else {
          await auth.api.createOrganization({
            body: {
              keepCurrentActiveOrganization: true,
              name: input.data.name,
              slug: slug.data,
            },
            headers: requestHeaders,
          });
          revalidatePath('/organizations');
          destination = organizationPath(slug.data);
        }
      } catch (error) {
        destination = isSlugTakenError(error)
          ? resultPath('/organizations/new', 'slug-taken')
          : resultPath('/organizations/new', 'error');
      }
    }
  }

  redirect(destination as Route);
}

// Accepts a pending invitation addressed to the caller; the id travels only in the form body.
export async function acceptOrganizationInvitationAction(
  formData: FormData,
): Promise<never> {
  return respondToInvitation(formData, 'accept');
}

// Declines a pending invitation addressed to the caller; the id travels only in the form body.
export async function declineOrganizationInvitationAction(
  formData: FormData,
): Promise<never> {
  return respondToInvitation(formData, 'decline');
}

async function respondToInvitation(
  formData: FormData,
  decision: 'accept' | 'decline',
): Promise<never> {
  const input = invitationInputIdSchema.safeParse({
    invitationId: formValue(formData, 'invitationId'),
  });
  let destination = resultPath(
    '/organizations',
    decision === 'accept' ? 'accept-error' : 'decline-error',
  );

  if (input.success) {
    try {
      const auth = await getAuth();
      const requestHeaders = await headers();
      const session = await auth.api.getSession({ headers: requestHeaders });
      if (session?.user.emailVerified !== true) {
        throw new Error('Invitation response unavailable.');
      }
      // Better Auth compares the invitation email to the session, so only the recipient can respond.
      if (decision === 'accept') {
        await auth.api.acceptInvitation({
          body: { invitationId: input.data.invitationId },
          headers: requestHeaders,
        });
      } else {
        await auth.api.rejectInvitation({
          body: { invitationId: input.data.invitationId },
          headers: requestHeaders,
        });
      }
      revalidatePath('/organizations');
      destination = resultPath(
        '/organizations',
        decision === 'accept' ? 'accept-success' : 'decline-success',
      );
    } catch {
      destination = resultPath(
        '/organizations',
        decision === 'accept' ? 'accept-error' : 'decline-error',
      );
    }
  }

  redirect(destination as Route);
}
