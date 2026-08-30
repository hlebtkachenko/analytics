import { z } from 'zod';

export const organizationIdentifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);

export const organizationRoleSchema = z.enum(['owner', 'admin', 'member']);

export const accessServiceSchema = z.enum(['application-api', 'reporting-api']);

// Capabilities only tell the UI which actions to show, the database stays the enforcement layer.
export const organizationCapabilitiesSchema = z
  .object({
    manageGrants: z.boolean(),
    manageMembers: z.boolean(),
    uploadData: z.boolean(),
    useAi: z.boolean(),
  })
  .strict();

export const organizationAccessResponseSchema = z
  .object({
    capabilities: organizationCapabilitiesSchema,
    organizationId: organizationIdentifierSchema,
    role: organizationRoleSchema,
    service: accessServiceSchema,
  })
  .strict();

export type AccessService = z.infer<typeof accessServiceSchema>;
export type OrganizationAccessResponse = z.infer<
  typeof organizationAccessResponseSchema
>;
export type OrganizationCapabilities = z.infer<
  typeof organizationCapabilitiesSchema
>;
export type OrganizationRole = z.infer<typeof organizationRoleSchema>;

export interface MembershipResolution {
  emailVerified: boolean;
  role: OrganizationRole | null;
}

// The single source of truth for the role to capability mapping.
const capabilitiesByRole: Readonly<
  Record<OrganizationRole, OrganizationCapabilities>
> = {
  admin: {
    manageGrants: false,
    manageMembers: true,
    uploadData: true,
    useAi: true,
  },
  member: {
    manageGrants: false,
    manageMembers: false,
    uploadData: true,
    useAi: true,
  },
  owner: {
    manageGrants: true,
    manageMembers: true,
    uploadData: true,
    useAi: true,
  },
};

export function resolveCapabilities(
  role: OrganizationRole,
): OrganizationCapabilities {
  return { ...capabilitiesByRole[role] };
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
    capabilities: resolveCapabilities(membership.role),
    organizationId,
    role: membership.role,
    service,
  });
}
