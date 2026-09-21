'use server';

import { headers } from 'next/headers';
import type { Route } from 'next';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import {
  getOrganizationCreationQuota,
  transferOwnership,
  writeInvitationEntityScope,
} from '@bap/db/access';

import { getAuth, getAuthPool } from '../auth/server';
import { entityScopeWriteSchema } from '../auth/bff';
import { formValue, resultPath } from './action-support';
import { normalizeOrganizationSlug, organizationSlugSchema } from './slug';

const invitationInputIdSchema = z.object({ invitationId: z.string().min(1) });

const transferOwnershipInputSchema = z.object({
  organizationId: z.string().min(1),
  toUserId: z.string().min(1),
});

export type TransferOwnershipResult =
  Readonly<{ ok: true }> | Readonly<{ ok: false }>;

// Hands ownership to another active member and demotes the caller to admin. Authorization
// is enforced in the database function: the caller is bound to the session user as the
// from-owner, so a non-owner caller is refused inside the transaction.
export async function transferOwnershipAction(
  input: unknown,
): Promise<TransferOwnershipResult> {
  const parsed = transferOwnershipInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false };
  }

  try {
    const auth = await getAuth();
    const requestHeaders = await headers();
    const session = await auth.api.getSession({ headers: requestHeaders });
    if (session?.user.emailVerified !== true) {
      return { ok: false };
    }

    await transferOwnership(
      await getAuthPool(),
      parsed.data.organizationId,
      session.user.id,
      parsed.data.toUserId,
    );
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

const inviteMemberWithScopeInputSchema = z.object({
  email: z.email().max(254),
  organizationId: z.string().min(1),
  role: z.enum(['admin', 'member']),
  scope: entityScopeWriteSchema,
});

export type InviteMemberWithScopeResult =
  | Readonly<{ ok: true }>
  | Readonly<{
      ok: false;
      reason: 'already-invited' | 'already-member' | 'error' | 'invalid';
    }>;

// Better Auth reports these on invite; both keep the modal open with an inline explanation.
function invitationErrorCode(error: unknown): string | null {
  if (
    typeof error === 'object' &&
    error !== null &&
    'body' in error &&
    typeof (error as { body?: unknown }).body === 'object'
  ) {
    const code = (error as { body?: { code?: unknown } }).body?.code;
    return typeof code === 'string' ? code : null;
  }
  return null;
}

// Creates the invitation and stores the entity scope its acceptance will apply. Owners choose the
// scope at invite time because entity access is granted, never assumed; the accept hook applies it.
// The invitation is created first, then its scope; a scope that names an unknown entity cancels the
// invitation so no half-formed invite survives. Authorization is Better Auth's: the session user
// must hold the invite permission in this organization.
export async function inviteMemberWithScopeAction(
  input: unknown,
): Promise<InviteMemberWithScopeResult> {
  const parsed = inviteMemberWithScopeInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: 'invalid' };
  }

  try {
    const auth = await getAuth();
    const requestHeaders = await headers();
    const session = await auth.api.getSession({ headers: requestHeaders });
    if (session?.user.emailVerified !== true) {
      return { ok: false, reason: 'error' };
    }

    let invitationId: string;
    try {
      const invitation = await auth.api.createInvitation({
        body: {
          email: parsed.data.email.toLowerCase(),
          organizationId: parsed.data.organizationId,
          role: parsed.data.role,
        },
        headers: requestHeaders,
      });
      const id = (invitation as { id?: unknown }).id;
      if (typeof id !== 'string' || id.length === 0) {
        return { ok: false, reason: 'error' };
      }
      invitationId = id;
    } catch (error) {
      const code = invitationErrorCode(error);
      if (code === 'USER_IS_ALREADY_INVITED_TO_THIS_ORGANIZATION') {
        return { ok: false, reason: 'already-invited' };
      }
      if (code === 'USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION') {
        return { ok: false, reason: 'already-member' };
      }
      return { ok: false, reason: 'error' };
    }

    const written = await writeInvitationEntityScope(await getAuthPool(), {
      createdBy: session.user.id,
      invitationId,
      organizationId: parsed.data.organizationId,
      scope: parsed.data.scope,
    });

    if (written === 'unknown-entity') {
      // Roll the invitation back so it never accepts into a scope that could not be stored.
      await auth.api.cancelInvitation({
        body: { invitationId },
        headers: requestHeaders,
      });
      return { ok: false, reason: 'invalid' };
    }

    return { ok: true };
  } catch {
    return { ok: false, reason: 'error' };
  }
}

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
const createWorkspaceInputSchema = z.object({
  name: organizationNameSchema,
  slug: z.string(),
});

// Better Auth returns the created organization; only its id and slug are read back.
const createdOrganizationSchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
});

export type CreateWorkspaceResult =
  | Readonly<{ ok: true; id: string; slug: string }>
  | Readonly<{
      ok: false;
      reason: 'slug-taken' | 'quota-exhausted' | 'invalid' | 'error';
    }>;

// Creates the workspace and returns its id and slug so the wizard can commit its next steps
// against the real organization. Unlike the redirecting form action, every outcome is a value the
// browser branches on. Better Auth makes the caller the owner; the slug is validated at the boundary.
export async function createWorkspaceAction(
  input: unknown,
): Promise<CreateWorkspaceResult> {
  const parsed = createWorkspaceInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: 'invalid' };
  }

  const slug = organizationSlugSchema.safeParse(
    normalizeOrganizationSlug(parsed.data.slug),
  );
  if (!slug.success) {
    return { ok: false, reason: 'invalid' };
  }

  try {
    const auth = await getAuth();
    const requestHeaders = await headers();
    const session = await auth.api.getSession({ headers: requestHeaders });
    if (session?.user.emailVerified !== true) {
      return { ok: false, reason: 'error' };
    }

    const quota = await getOrganizationCreationQuota(
      await getAuthPool(),
      session.user.id,
    );
    if (quota !== null && quota.remainingTotal === 0) {
      return { ok: false, reason: 'quota-exhausted' };
    }

    const created = await auth.api.createOrganization({
      body: {
        keepCurrentActiveOrganization: true,
        name: parsed.data.name,
        slug: slug.data,
      },
      headers: requestHeaders,
    });
    const organization = createdOrganizationSchema.safeParse(created);
    if (!organization.success) {
      return { ok: false, reason: 'error' };
    }

    revalidatePath('/workspaces');
    return {
      id: organization.data.id,
      ok: true,
      slug: organization.data.slug,
    };
  } catch (error) {
    return isSlugTakenError(error)
      ? { ok: false, reason: 'slug-taken' }
      : { ok: false, reason: 'error' };
  }
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
    '/workspaces',
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
      revalidatePath('/workspaces');
      destination = resultPath(
        '/workspaces',
        decision === 'accept' ? 'accept-success' : 'decline-success',
      );
    } catch {
      destination = resultPath(
        '/workspaces',
        decision === 'accept' ? 'accept-error' : 'decline-error',
      );
    }
  }

  redirect(destination as Route);
}
