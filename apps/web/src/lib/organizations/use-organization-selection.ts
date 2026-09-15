'use client';

import { useEffect, useState } from 'react';
import { z } from 'zod';

import { getJson, isAbortError } from '../datasets/client';

const organizationsSchema = z.array(
  z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    slug: z.string().min(1),
  }),
);

type Organization = z.infer<typeof organizationsSchema>[number];

export type OrganizationSelection = Readonly<{
  organizationId: string;
  organizations: Organization[];
  select: (id: string) => void;
  slug: string;
  state: 'error' | 'idle' | 'loading';
}>;

// The membership list every product page starts from, honouring ?organization=<slug>.
export function useOrganizationSelection(): OrganizationSelection {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [organizationId, setOrganizationId] = useState('');
  const [state, setState] = useState<'error' | 'idle' | 'loading'>('loading');

  useEffect(() => {
    const controller = new AbortController();
    void getJson('/api/auth/organization/list', controller.signal)
      .then((payload) => organizationsSchema.parse(payload))
      .then((items) => {
        const requestedSlug = new URLSearchParams(window.location.search).get(
          'organization',
        );
        const requested = items.find(
          (organization) => organization.slug === requestedSlug,
        );
        setOrganizations(items);
        setOrganizationId(requested?.id ?? items[0]?.id ?? '');
        setState('idle');
      })
      .catch((error: unknown) => {
        if (!isAbortError(error)) {
          setState('error');
        }
      });
    return () => {
      controller.abort();
    };
  }, []);

  return {
    organizationId,
    organizations,
    select: setOrganizationId,
    slug:
      organizations.find((organization) => organization.id === organizationId)
        ?.slug ?? '',
    state,
  };
}
