import { z } from 'zod';

import {
  callApplicationJson,
  legalEntityIdSchema,
  parsedIdentifier,
  prepareApplicationCall,
  readJsonBody,
} from './core.ts';
import type { BffAuth } from './core.ts';

const MAX_LEGAL_ENTITY_NAME_LENGTH = 200;

// The same bound and alphabet the database check constraint enforces on app.legal_entity.
const MAX_REGISTRATION_NUMBER_LENGTH = 32;

const registrationNumberPattern = /^[A-Za-z0-9-]+$/;

export const legalEntityKindSchema = z.enum(['company', 'sole_trader']);

// Mirrors the legal entity contract in @bap/api, which apps/web must not import.
export const legalEntitySchema = z
  .object({
    createdAt: z.iso.datetime(),
    id: legalEntityIdSchema,
    kind: legalEntityKindSchema,
    name: z.string(),
    registrationNumber: z.string().nullable(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export const legalEntityListSchema = z
  .object({ legalEntities: z.array(legalEntitySchema) })
  .strict();

const registrationNumberSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_REGISTRATION_NUMBER_LENGTH)
  .regex(registrationNumberPattern);

export const legalEntityCreateBodySchema = z
  .object({
    kind: legalEntityKindSchema,
    name: z.string().trim().min(1).max(MAX_LEGAL_ENTITY_NAME_LENGTH),
    registrationNumber: registrationNumberSchema.optional(),
  })
  .strict();

// A patch carries only what changes, an empty object is refused, and null clears the number.
export const legalEntityUpdateBodySchema = legalEntityCreateBodySchema
  .partial()
  .extend({
    registrationNumber: registrationNumberSchema.nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0);

export type LegalEntity = z.infer<typeof legalEntitySchema>;

export async function getLegalEntities(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const prepared = await prepareApplicationCall(auth, request, organizationId);

  if ('failure' in prepared) {
    return prepared.failure;
  }

  return await callApplicationJson(
    prepared,
    {
      errorCode: 'legal_entities_unavailable',
      method: 'GET',
      operation: 'getLegalEntities',
      path: 'legal-entities',
      schema: legalEntityListSchema,
      successStatus: 200,
    },
    fetchImplementation,
  );
}

export async function postLegalEntity(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const body = await readJsonBody(request, legalEntityCreateBodySchema);

  if ('failure' in body) {
    return body.failure;
  }

  const prepared = await prepareApplicationCall(auth, request, organizationId);

  if ('failure' in prepared) {
    return prepared.failure;
  }

  return await callApplicationJson(
    prepared,
    {
      body: body.data,
      errorCode: 'legal_entity_rejected',
      method: 'POST',
      operation: 'postLegalEntity',
      path: 'legal-entities',
      schema: legalEntitySchema,
      successStatus: 201,
    },
    fetchImplementation,
  );
}

export async function patchLegalEntity(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  legalEntityId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const selectedEntity = parsedIdentifier(
    legalEntityId,
    'legal_entity_not_found',
  );

  if ('failure' in selectedEntity) {
    return selectedEntity.failure;
  }

  const body = await readJsonBody(request, legalEntityUpdateBodySchema);

  if ('failure' in body) {
    return body.failure;
  }

  const prepared = await prepareApplicationCall(auth, request, organizationId);

  if ('failure' in prepared) {
    return prepared.failure;
  }

  return await callApplicationJson(
    prepared,
    {
      body: body.data,
      errorCode: 'legal_entity_rejected',
      method: 'PATCH',
      operation: 'patchLegalEntity',
      path: `legal-entities/${encodeURIComponent(selectedEntity.value)}`,
      schema: legalEntitySchema,
      successStatus: 200,
    },
    fetchImplementation,
  );
}

export async function deleteLegalEntity(
  auth: BffAuth,
  request: Request,
  organizationId: string,
  legalEntityId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  const selectedEntity = parsedIdentifier(
    legalEntityId,
    'legal_entity_not_found',
  );

  if ('failure' in selectedEntity) {
    return selectedEntity.failure;
  }

  const prepared = await prepareApplicationCall(auth, request, organizationId);

  if ('failure' in prepared) {
    return prepared.failure;
  }

  return await callApplicationJson(
    prepared,
    {
      errorCode: 'legal_entity_rejected',
      method: 'DELETE',
      operation: 'deleteLegalEntity',
      path: `legal-entities/${encodeURIComponent(selectedEntity.value)}`,
      schema: null,
      successStatus: 204,
    },
    fetchImplementation,
  );
}
