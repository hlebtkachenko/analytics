'use client';

import { useEffect, useState } from 'react';

import { listOrganizationMembers } from './client';
import type { OrganizationMember } from './contract.ts';

export type { OrganizationMember };

// The answer carries the organization it described, so another tenant's members never linger.
type MembersResult = Readonly<{ key: string; members: OrganizationMember[] }>;

// Members for the pickers; undefined until loaded, so an id reads "A member", not "A former member".
export function useMembers(
  organizationId: string,
): OrganizationMember[] | undefined {
  const [result, setResult] = useState<MembersResult>();

  useEffect(() => {
    if (organizationId.length === 0) {
      return;
    }

    let active = true;
    void listOrganizationMembers(organizationId)
      .then((members) => {
        if (active) {
          setResult({ key: organizationId, members });
        }
      })
      .catch(() => {
        // A failed load stays unresolved, so a name never reads as a former member.
        if (active) {
          setResult(undefined);
        }
      });
    return () => {
      active = false;
    };
  }, [organizationId]);

  return result?.key === organizationId ? result.members : undefined;
}
