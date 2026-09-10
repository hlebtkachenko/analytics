import {
  entityScopeOpenApiSchema,
  entityScopeSchema,
  legalEntityKindSchema,
  legalEntityNameSchema,
  legalEntityRegistrationNumberSchema,
  legalEntitySchema,
} from '@bap/security';
import { z } from 'zod';

import { subjectIdentifierSchema } from '../worker/job-context.js';

// The whole list is bounded on the server; no client parameter widens it.
export const MAX_LEGAL_ENTITY_LIST_SIZE = 200;

export const legalEntityListResponseSchema = z
  .object({ legalEntities: z.array(legalEntitySchema) })
  .strict();

export type LegalEntityListResponse = z.infer<
  typeof legalEntityListResponseSchema
>;

export const createLegalEntityRequestSchema = z
  .object({
    kind: legalEntityKindSchema,
    name: legalEntityNameSchema,
    // Absent and null both mean "no registration number"; the column is nullable.
    registrationNumber: legalEntityRegistrationNumberSchema.nullish(),
  })
  .strict();

export type CreateLegalEntityRequest = z.infer<
  typeof createLegalEntityRequestSchema
>;

// Every field is optional, but an empty body changes nothing and is rejected instead of accepted silently.
export const updateLegalEntityRequestSchema = z
  .object({
    kind: legalEntityKindSchema.optional(),
    name: legalEntityNameSchema.optional(),
    registrationNumber: legalEntityRegistrationNumberSchema.nullish(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one field must be provided.',
  });

export type UpdateLegalEntityRequest = z.infer<
  typeof updateLegalEntityRequestSchema
>;

// The request and the response are the same shape, so a client can read a scope and write it back unchanged.
export const entityScopeRequestSchema = entityScopeSchema;

export type EntityScopeRequest = z.infer<typeof entityScopeRequestSchema>;

// One entry per stored scope row: a member without a row is implicitly unrestricted and is left out.
export const memberEntityScopeListResponseSchema = z
  .object({
    entityScopes: z.array(
      z
        .object({
          entityScope: entityScopeSchema,
          userId: subjectIdentifierSchema,
        })
        .strict(),
    ),
  })
  .strict();

export type MemberEntityScopeListResponse = z.infer<
  typeof memberEntityScopeListResponseSchema
>;

export const legalEntityOpenApiSchema = {
  additionalProperties: false,
  properties: {
    createdAt: { format: 'date-time', type: 'string' },
    id: { format: 'uuid', type: 'string' },
    kind: { enum: ['company', 'sole_trader'], type: 'string' },
    name: { maxLength: 200, minLength: 1, type: 'string' },
    registrationNumber: { maxLength: 32, nullable: true, type: 'string' },
    updatedAt: { format: 'date-time', type: 'string' },
  },
  required: [
    'createdAt',
    'id',
    'kind',
    'name',
    'registrationNumber',
    'updatedAt',
  ],
  type: 'object',
};

export const legalEntityBodyOpenApiSchema = {
  additionalProperties: false,
  properties: {
    kind: { enum: ['company', 'sole_trader'], type: 'string' },
    name: { maxLength: 200, minLength: 1, type: 'string' },
    registrationNumber: {
      maxLength: 32,
      minLength: 1,
      nullable: true,
      type: 'string',
    },
  },
  required: ['kind', 'name'],
  type: 'object',
};

// The scope shape is published by the shared contract, so both services and every scope route agree.
export { entityScopeOpenApiSchema };

export const memberEntityScopeListOpenApiSchema = {
  additionalProperties: false,
  properties: {
    entityScopes: {
      items: {
        additionalProperties: false,
        properties: {
          entityScope: entityScopeOpenApiSchema,
          userId: { type: 'string' },
        },
        required: ['entityScope', 'userId'],
        type: 'object',
      },
      type: 'array',
    },
  },
  required: ['entityScopes'],
  type: 'object',
};
