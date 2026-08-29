import { z } from 'zod';

export const organizationIdentifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);

export const organizationRoleSchema = z.enum(['owner', 'admin', 'member']);

export const accessServiceSchema = z.enum(['application-api', 'reporting-api']);

export const organizationAccessResponseSchema = z
  .object({
    organizationId: organizationIdentifierSchema,
    role: organizationRoleSchema,
    service: accessServiceSchema,
  })
  .strict();

export type AccessService = z.infer<typeof accessServiceSchema>;
export type OrganizationAccessResponse = z.infer<
  typeof organizationAccessResponseSchema
>;
export type OrganizationRole = z.infer<typeof organizationRoleSchema>;

export interface MembershipResolution {
  emailVerified: boolean;
  role: OrganizationRole | null;
}

export function resolveOrganizationAccess(
  service: AccessService,
  organizationId: string,
  membership: MembershipResolution,
): OrganizationAccessResponse | null {
  if (!membership.emailVerified || membership.role === null) {
    return null;
  }

  return organizationAccessResponseSchema.parse({
    organizationId,
    role: membership.role,
    service,
  });
}
