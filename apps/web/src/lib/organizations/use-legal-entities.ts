'use client';

import { useEffect, useState } from 'react';

import {
  getJson,
  isAbortError,
  legalEntitiesPath,
  legalEntityListSchema,
} from '../datasets/client';
import type { LegalEntity } from '../datasets/client';

// The answer carries the organization it described, so another tenant's entities never linger.
type LegalEntitiesResult = Readonly<{
  key: string;
  legalEntities: LegalEntity[];
}>;

const noLegalEntities: LegalEntity[] = [];

// The entity filter every scoped page offers; a failed read leaves the whole organization selected.
export function useLegalEntities(organizationId: string): LegalEntity[] {
  const [result, setResult] = useState<LegalEntitiesResult>();

  useEffect(() => {
    if (organizationId.length === 0) {
      return;
    }

    const controller = new AbortController();
    void getJson(legalEntitiesPath(organizationId), controller.signal)
      .then((payload) => legalEntityListSchema.parse(payload))
      .then((payload) => {
        setResult({
          key: organizationId,
          legalEntities: payload.legalEntities,
        });
      })
      .catch((error: unknown) => {
        if (!isAbortError(error)) {
          setResult({ key: organizationId, legalEntities: [] });
        }
      });
    return () => {
      controller.abort();
    };
  }, [organizationId]);

  return result?.key === organizationId
    ? result.legalEntities
    : noLegalEntities;
}
