import {
  entityScopeSchema,
  legalEntityKindSchema,
  legalEntityNameSchema,
  legalEntityRegistrationNumberSchema,
  legalEntitySchema,
} from '@bap/security';
import { z } from 'zod';

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
