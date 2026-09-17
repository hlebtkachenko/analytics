import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { ActiveOrganization } from '../../../components/shell/active-organization';
import { resolveOrganizationRouteForRequest } from '../../../lib/organizations/resolver';

export default async function OrganizationLayout({
  children,
  params,
}: Readonly<{
  children: ReactNode;
  params: Promise<{ orgSlug: string }>;
}>) {
  const { orgSlug } = await params;
  const organization = await resolveOrganizationRouteForRequest(orgSlug);

  if (organization === null) {
    notFound();
  }

  return (
    <>
      <ActiveOrganization
        id={organization.id}
        name={organization.name}
        role={organization.role}
        slug={organization.slug}
      />
      {children}
    </>
  );
}
