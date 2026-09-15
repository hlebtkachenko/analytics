'use client';

import { useEffect, useState } from 'react';

import {
  accessPath,
  getJson,
  isAbortError,
  organizationAccessSchema,
} from '../datasets/client';
import type { OrganizationAccess } from '../datasets/client';

export type OrganizationAccessRead = Readonly<{
  access: OrganizationAccess | undefined;
  state: 'error' | 'idle' | 'loading';
}>;

// The answer carries the organization it described, so another tenant's capabilities never linger.
type AccessResult = Readonly<{ access?: OrganizationAccess; key: string }>;

// The capability gate every product page reads, refused whenever the answer names another organization.
export function useOrganizationAccess(
  organizationId: string,
): OrganizationAccessRead {
  const [result, setResult] = useState<AccessResult>();

  useEffect(() => {
    if (organizationId.length === 0) {
      return;
    }

    const controller = new AbortController();
    void getJson(accessPath(organizationId), controller.signal)
      .then((payload) => organizationAccessSchema.parse(payload))
      .then((contract) => {
        if (contract.organizationId !== organizationId) {
          throw new Error('Organization mismatch.');
        }
        setResult({ access: contract, key: organizationId });
      })
      .catch((error: unknown) => {
        if (!isAbortError(error)) {
          setResult({ key: organizationId });
        }
      });
    return () => {
      controller.abort();
    };
  }, [organizationId]);

  const current = result?.key === organizationId ? result : undefined;
  return {
    access: current?.access,
    state:
      current === undefined
        ? 'loading'
        : current.access === undefined
          ? 'error'
          : 'idle',
  };
}
