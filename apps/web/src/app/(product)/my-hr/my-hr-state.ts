'use client';
import { useEffect, useState } from 'react';
import {
  getMyHrAccess,
  getMyHrProfile,
} from '../../../lib/hr-self-service/client';
import { useOrganizationSelection } from '../../../lib/organizations/use-organization-selection';

export function useMyHr() {
  const organization = useOrganizationSelection();
  const [state, setState] = useState<
    'loading' | 'error' | 'unavailable' | 'ready'
  >('loading');
  const [profile, setProfile] =
    useState<Awaited<ReturnType<typeof getMyHrProfile>>>();
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setProfile(undefined);
      setState('loading');
    });
    if (organization.state === 'error') {
      queueMicrotask(() => {
        if (active) setState('error');
      });
      return () => {
        active = false;
      };
    }
    if (!organization.organizationId)
      return () => {
        active = false;
      };
    void getMyHrAccess(organization.organizationId)
      .then((access) => {
        if (!access.available) {
          if (active) setState('unavailable');
          return;
        }
        return getMyHrProfile(organization.organizationId).then((value) => {
          if (!active) return;
          setProfile(value);
          setState('ready');
        });
      })
      .catch(() => {
        if (active) setState('error');
      });
    return () => {
      active = false;
    };
  }, [organization.organizationId, organization.state]);
  return { organization, profile, state };
}
