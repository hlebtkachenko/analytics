import { z } from 'zod';

export const organizationIdentifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);

export const organizationRoleSchema = z.enum(['owner', 'admin', 'member']);

export const accessServiceSchema = z.enum(['application-api', 'reporting-api']);

// Lower-cased at the boundary: PostgreSQL emits lower-case uuids, so scope comparisons stay textual and exact.
export const legalEntityIdentifierSchema = z
  .string()
  .trim()
  .toLowerCase()
  .uuid();

export const legalEntityKindSchema = z.enum(['company', 'sole_trader']);

// The same bound and alphabet the database check constraint enforces on app.legal_entity.
export const legalEntityRegistrationNumberSchema = z
  .string()
  .trim()
  .min(1)
  .max(32)
  .regex(/^[A-Za-z0-9-]+$/);

export const legalEntityNameSchema = z.string().trim().min(1).max(200);

export const legalEntitySchema = z
  .object({
    createdAt: z.iso.datetime(),
    id: legalEntityIdentifierSchema,
    kind: legalEntityKindSchema,
    name: legalEntityNameSchema,
    registrationNumber: legalEntityRegistrationNumberSchema.nullable(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

// Discriminated on mode so a restricted scope can never arrive without its explicit entity list.
export const entityScopeSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('all') }).strict(),
  z
    .object({
      legalEntityIds: z.array(legalEntityIdentifierSchema),
      mode: z.literal('restricted'),
    })
    .strict(),
]);

// Capabilities only tell the UI which actions to show, the database stays the enforcement layer.
export const organizationCapabilitiesSchema = z
  .object({
    createEntities: z.boolean(),
    deleteEntities: z.boolean(),
    manageEntityAccess: z.boolean(),
    manageMembers: z.boolean(),
    manageOrganization: z.boolean(),
    updateEntities: z.boolean(),
    uploadData: z.boolean(),
    useAi: z.boolean(),
  })
  .strict();

// Derived from the schema so a new capability cannot be forgotten in an OpenAPI document.
export const organizationCapabilityNames = Object.keys(
  organizationCapabilitiesSchema.shape,
);

// The published entity scope shape; both services and every scope route document the same one.
export const entityScopeOpenApiSchema = {
  oneOf: [
    {
      additionalProperties: false,
      properties: { mode: { enum: ['all'], type: 'string' } },
      required: ['mode'],
      type: 'object',
    },
    {
      additionalProperties: false,
      properties: {
        legalEntityIds: {
          items: { format: 'uuid', type: 'string' },
          type: 'array',
        },
        mode: { enum: ['restricted'], type: 'string' },
      },
      required: ['legalEntityIds', 'mode'],
      type: 'object',
    },
  ],
};

export const organizationAccessResponseSchema = z
  .object({
    capabilities: organizationCapabilitiesSchema,
    entityScope: entityScopeSchema,
    organizationId: organizationIdentifierSchema,
    role: organizationRoleSchema,
    service: accessServiceSchema,
  })
  .strict();

export type AccessService = z.infer<typeof accessServiceSchema>;
export type EntityScope = z.infer<typeof entityScopeSchema>;
export type LegalEntity = z.infer<typeof legalEntitySchema>;
export type LegalEntityKind = z.infer<typeof legalEntityKindSchema>;
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
    createEntities: true,
    deleteEntities: false,
    manageEntityAccess: false,
    manageMembers: false,
    manageOrganization: false,
    updateEntities: true,
    uploadData: true,
    useAi: true,
  },
  member: {
    createEntities: false,
    deleteEntities: false,
    manageEntityAccess: false,
    manageMembers: false,
    manageOrganization: false,
    updateEntities: false,
    uploadData: false,
    useAi: true,
  },
  owner: {
    createEntities: true,
    deleteEntities: true,
    manageEntityAccess: true,
    manageMembers: true,
    manageOrganization: true,
    updateEntities: true,
    uploadData: true,
    useAi: true,
  },
};

export function resolveCapabilities(
  role: OrganizationRole,
): OrganizationCapabilities {
  return { ...capabilitiesByRole[role] };
}

// An owner is never restricted, so a restricted scope carrying an owner is a resolver bug, not an input.
export function legalEntityInScope(
  scope: EntityScope,
  legalEntityId: string,
): boolean {
  return scope.mode === 'all' || scope.legalEntityIds.includes(legalEntityId);
}

export function resolveOrganizationAccess(
  service: AccessService,
  organizationId: string,
  membership: MembershipResolution,
  entityScope: EntityScope,
): OrganizationAccessResponse | null {
  if (!membership.emailVerified || membership.role === null) {
    return null;
  }

  const capabilities = resolveCapabilities(membership.role);

  // A restricted caller could not see what it created, so entity creation leaves the capability set.
  if (entityScope.mode === 'restricted') {
    capabilities.createEntities = false;
  }

  return organizationAccessResponseSchema.parse({
    capabilities,
    entityScope,
    organizationId,
    role: membership.role,
    service,
  });
}
