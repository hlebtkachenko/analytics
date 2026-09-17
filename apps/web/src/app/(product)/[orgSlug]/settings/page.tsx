import { notFound } from 'next/navigation';

import PageContainer from '../../../../components/page-container';
import { readOrganizationAccess } from '../../../../lib/organizations/entities';
import { resolveOrganizationRouteForRequest } from '../../../../lib/organizations/resolver';
import SettingsView from './settings-view';

export default async function OrganizationSettingsPage({
  params,
}: Readonly<{ params: Promise<{ orgSlug: string }> }>) {
  const { orgSlug } = await params;
  const organization = await resolveOrganizationRouteForRequest(orgSlug);
  if (organization === null) {
    notFound();
  }

  // A failed access read must never render editable controls, so it falls back to read-only.
  const access = await readOrganizationAccess(organization.id);
  const canManageOrganization =
    access?.capabilities.manageOrganization ?? false;

  return (
    <PageContainer>
      <SettingsView
        canManageOrganization={canManageOrganization}
        organizationId={organization.id}
        workspaceName={organization.name}
        workspaceSlug={organization.slug}
      />
    </PageContainer>
  );
}
