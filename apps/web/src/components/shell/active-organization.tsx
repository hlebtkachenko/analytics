'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

export type ActiveOrganizationValue =
  | Readonly<{ id: string; name: string; role: string; slug: string }>
  | undefined;

type ActiveOrganizationContextValue = Readonly<{
  organization: ActiveOrganizationValue;
  setOrganization: (organization: ActiveOrganizationValue) => void;
}>;

const ActiveOrganizationContext = createContext<ActiveOrganizationContextValue>(
  {
    organization: undefined,
    setOrganization: () => {},
  },
);

export function useActiveOrganization(): ActiveOrganizationValue {
  return useContext(ActiveOrganizationContext).organization;
}

export function ActiveOrganizationProvider({
  children,
}: Readonly<{ children: ReactNode }>) {
  const [organization, setOrganization] =
    useState<ActiveOrganizationValue>(undefined);
  const value = useMemo(
    () => ({ organization, setOrganization }),
    [organization],
  );

  return (
    <ActiveOrganizationContext.Provider value={value}>
      {children}
    </ActiveOrganizationContext.Provider>
  );
}

// Rendered by the workspace layout to publish the resolved organization so the
// shell breadcrumb and rail can label it; clears itself when the route leaves.
export function ActiveOrganization({
  id,
  name,
  role,
  slug,
}: Readonly<{ id: string; name: string; role: string; slug: string }>) {
  const { setOrganization } = useContext(ActiveOrganizationContext);

  useEffect(() => {
    setOrganization({ id, name, role, slug });
    return () => setOrganization(undefined);
  }, [id, name, role, slug, setOrganization]);

  return null;
}
