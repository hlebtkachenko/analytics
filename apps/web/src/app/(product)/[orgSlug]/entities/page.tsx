import { notFound } from 'next/navigation';

import PageContainer from '../../../../components/page-container';
import {
  readLegalEntities,
  readOrganizationAccess,
} from '../../../../lib/organizations/entities';
import { resolveOrganizationRouteForRequest } from '../../../../lib/organizations/resolver';
import EntitiesView from './entities-view';

export default async function OrganizationEntitiesPage({
  params,
}: Readonly<{ params: Promise<{ orgSlug: string }> }>) {
  const { orgSlug } = await params;
  const organization = await resolveOrganizationRouteForRequest(orgSlug);
  if (organization === null) {
    notFound();
  }

  // Capabilities only choose which controls render, the API and the database enforce access.
  const [access, entities] = await Promise.all([
    readOrganizationAccess(organization.id),
    readLegalEntities(organization.id),
  ]);
  const capabilities = access?.capabilities;

  return (
    <PageContainer>
      <EntitiesView
        canCreate={capabilities?.createEntities ?? false}
        canDelete={capabilities?.deleteEntities ?? false}
        canUpdate={capabilities?.updateEntities ?? false}
        initialEntities={entities ?? []}
        loadError={entities === null}
        organizationId={organization.id}
        workspaceName={organization.name}
      />
    </PageContainer>
  );
}
