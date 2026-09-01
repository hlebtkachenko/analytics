'use server';

import { headers } from 'next/headers';
import type { Route } from 'next';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { getAuth } from '../auth/server';
import { resolveOrganizationRouteForRequest } from './resolver';
import { normalizeOrganizationSlug, organizationSlugSchema } from './slug';

const organizationNameSchema = z.string().trim().min(1);
const organizationRoleSchema = z.enum(['owner', 'admin', 'member']);
const createOrganizationInputSchema = z.object({
  name: organizationNameSchema,
  slug: z.string(),
});
const invitationInputSchema = z.object({
  email: z
    .email()
    .max(254)
    .transform((email) => email.toLowerCase()),
  role: organizationRoleSchema,
});
const memberRoleInputSchema = z.object({
  memberId: z.string().min(1),
  role: organizationRoleSchema,
});
const memberRemovalInputSchema = z.object({ memberId: z.string().min(1) });
const invalidScopedActionPath = '/organizations?result=error';

function formValue(formData: FormData, name: string): unknown {
  return formData.get(name);
}

function organizationPath(slug: string, suffix = ''): string {
  return `/${slug}${suffix}`;
}

function resultPath(path: string, result: 'error' | 'success'): string {
  return `${path}?result=${result}`;
}

async function resolveActionOrganization(slug: string) {
  const parsed = organizationSlugSchema.safeParse(slug);
  if (!parsed.success) {
    throw new Error('Organization action unavailable.');
  }

  const organization = await resolveOrganizationRouteForRequest(parsed.data);
  if (organization === null) {
    throw new Error('Organization action unavailable.');
  }

  return organization;
}

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
      } catch {
        destination = resultPath('/organizations/new', 'error');
      }
    }
  }

  redirect(destination as Route);
}

export async function inviteOrganizationMemberAction(
  organizationSlug: string,
  formData: FormData,
): Promise<never> {
  const routeSlug = organizationSlugSchema.safeParse(organizationSlug);
  if (!routeSlug.success) {
    return redirect(invalidScopedActionPath as Route);
  }

  const input = invitationInputSchema.safeParse({
    email: formValue(formData, 'email'),
    role: formValue(formData, 'role'),
  });
  let fallback = resultPath(
    organizationPath(routeSlug.data, '/members'),
    'error',
  );
  let destination = fallback;

  if (input.success) {
    try {
      const organization = await resolveActionOrganization(routeSlug.data);
      fallback = resultPath(
        organizationPath(organization.slug, '/members'),
        'error',
      );
      destination = fallback;
      const auth = await getAuth();
      await auth.api.createInvitation({
        body: {
          email: input.data.email,
          organizationId: organization.id,
          role: input.data.role,
        },
        headers: await headers(),
      });
      revalidatePath(organizationPath(organization.slug, '/members'));
      destination = resultPath(
        organizationPath(organization.slug, '/members'),
        'success',
      );
    } catch {
      destination = fallback;
    }
  }

  redirect(destination as Route);
}

export async function updateOrganizationMemberRoleAction(
  organizationSlug: string,
  formData: FormData,
): Promise<never> {
  const routeSlug = organizationSlugSchema.safeParse(organizationSlug);
  if (!routeSlug.success) {
    return redirect(invalidScopedActionPath as Route);
  }

  const input = memberRoleInputSchema.safeParse({
    memberId: formValue(formData, 'memberId'),
    role: formValue(formData, 'role'),
  });
  let fallback = resultPath(
    organizationPath(routeSlug.data, '/members'),
    'error',
  );
  let destination = fallback;

  if (input.success) {
    try {
      const organization = await resolveActionOrganization(routeSlug.data);
      fallback = resultPath(
        organizationPath(organization.slug, '/members'),
        'error',
      );
      destination = fallback;
      const auth = await getAuth();
      const requestHeaders = await headers();
      const memberList = await auth.api.listMembers({
        headers: requestHeaders,
        query: { limit: 100, organizationId: organization.id },
      });
      const target = memberList.members.find(
        (member) => member.id === input.data.memberId,
      );
      const ownerTotal = memberList.members.filter(
        (member) => member.role === 'owner',
      ).length;
      if (
        target === undefined ||
        (target.role === 'owner' &&
          input.data.role !== 'owner' &&
          ownerTotal <= 1)
      ) {
        throw new Error('Member role action unavailable.');
      }

      await auth.api.updateMemberRole({
        body: {
          memberId: input.data.memberId,
          organizationId: organization.id,
          role: input.data.role,
        },
        headers: requestHeaders,
      });
      revalidatePath(organizationPath(organization.slug, '/members'));
      destination = resultPath(
        organizationPath(organization.slug, '/members'),
        'success',
      );
    } catch {
      destination = fallback;
    }
  }

  redirect(destination as Route);
}

export async function removeOrganizationMemberAction(
  organizationSlug: string,
  formData: FormData,
): Promise<never> {
  const routeSlug = organizationSlugSchema.safeParse(organizationSlug);
  if (!routeSlug.success) {
    return redirect(invalidScopedActionPath as Route);
  }

  const input = memberRemovalInputSchema.safeParse({
    memberId: formValue(formData, 'memberId'),
  });
  let fallback = resultPath(
    organizationPath(routeSlug.data, '/members'),
    'error',
  );
  let destination = fallback;

  if (input.success) {
    try {
      const organization = await resolveActionOrganization(routeSlug.data);
      fallback = resultPath(
        organizationPath(organization.slug, '/members'),
        'error',
      );
      destination = fallback;
      const auth = await getAuth();
      const requestHeaders = await headers();
      const [memberList, session] = await Promise.all([
        auth.api.listMembers({
          headers: requestHeaders,
          query: { limit: 100, organizationId: organization.id },
        }),
        auth.api.getSession({ headers: requestHeaders }),
      ]);
      const target = memberList.members.find(
        (member) => member.id === input.data.memberId,
      );
      const ownerTotal = memberList.members.filter(
        (member) => member.role === 'owner',
      ).length;
      if (
        target === undefined ||
        session?.user.emailVerified !== true ||
        (target.role === 'owner' && ownerTotal <= 1)
      ) {
        throw new Error('Member removal unavailable.');
      }

      await auth.api.removeMember({
        body: {
          memberIdOrEmail: input.data.memberId,
          organizationId: organization.id,
        },
        headers: requestHeaders,
      });
      revalidatePath('/organizations');
      revalidatePath(organizationPath(organization.slug, '/members'));
      destination =
        target.userId === session.user.id
          ? '/organizations'
          : resultPath(
              organizationPath(organization.slug, '/members'),
              'success',
            );
    } catch {
      destination = fallback;
    }
  }

  redirect(destination as Route);
}

export async function updateOrganizationAction(
  organizationSlug: string,
  formData: FormData,
): Promise<never> {
  const routeSlug = organizationSlugSchema.safeParse(organizationSlug);
  if (!routeSlug.success) {
    return redirect(invalidScopedActionPath as Route);
  }

  const input = createOrganizationInputSchema.safeParse({
    name: formValue(formData, 'name'),
    slug: formValue(formData, 'slug'),
  });
  let fallback = resultPath(
    organizationPath(routeSlug.data, '/settings'),
    'error',
  );
  let destination = fallback;

  if (input.success) {
    const slug = organizationSlugSchema.safeParse(
      normalizeOrganizationSlug(input.data.slug),
    );
    if (slug.success) {
      try {
        const organization = await resolveActionOrganization(routeSlug.data);
        fallback = resultPath(
          organizationPath(organization.slug, '/settings'),
          'error',
        );
        destination = fallback;
        const auth = await getAuth();
        await auth.api.updateOrganization({
          body: {
            data: { name: input.data.name, slug: slug.data },
            organizationId: organization.id,
          },
          headers: await headers(),
        });
        revalidatePath('/organizations');
        revalidatePath(organizationPath(organization.slug), 'layout');
        destination = resultPath(
          organizationPath(slug.data, '/settings'),
          'success',
        );
      } catch {
        destination = fallback;
      }
    }
  }

  redirect(destination as Route);
}
