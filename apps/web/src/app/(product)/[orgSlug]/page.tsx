import {
  ClickableTile,
  Column,
  Grid,
  InlineNotification,
  Link,
  Stack,
  Tag,
} from '@bap/design-system/react';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';

import PageContainer from '../../../components/page-container';
import { createServerI18n } from '../../../i18n/server';
import {
  getAuth,
  organizationCreationConfiguration,
} from '../../../lib/auth/server';
import {
  readDatasets,
  readLegalEntities,
  readOrganizationAccess,
} from '../../../lib/organizations/entities';
import { resolveOrganizationRouteForRequest } from '../../../lib/organizations/resolver';

const roleLabelKeys = {
  admin: 'workspaces.list.roleAdmin',
  member: 'workspaces.list.roleMember',
  owner: 'workspaces.list.roleOwner',
} as const;

// The provider role maps to the three labelled roles, otherwise member.
function roleLabelKey(role: string): string {
  return role === 'owner' || role === 'admin'
    ? roleLabelKeys[role]
    : roleLabelKeys.member;
}

export default async function OrganizationLandingPage({
  params,
}: Readonly<{ params: Promise<{ orgSlug: string }> }>) {
  const { orgSlug } = await params;
  const organization = await resolveOrganizationRouteForRequest(orgSlug);
  if (organization === null) {
    notFound();
  }

  const auth = await getAuth();
  const requestHeaders = await headers();

  // Every read runs from the caller's session; a rejected or null read surfaces the notice.
  const [
    accessResult,
    entitiesResult,
    datasetsResult,
    membersResult,
    invitationsResult,
  ] = await Promise.allSettled([
    readOrganizationAccess(organization.id),
    readLegalEntities(organization.id),
    readDatasets(organization.id),
    auth.api.listMembers({
      headers: requestHeaders,
      query: { limit: 1, organizationId: organization.id },
    }),
    auth.api.listInvitations({
      headers: requestHeaders,
      query: { organizationId: organization.id },
    }),
  ]);

  const access =
    accessResult.status === 'fulfilled' ? accessResult.value : null;
  const legalEntities =
    entitiesResult.status === 'fulfilled' ? entitiesResult.value : null;
  const datasets =
    datasetsResult.status === 'fulfilled' ? datasetsResult.value : null;
  const memberTotal =
    membersResult.status === 'fulfilled' ? membersResult.value.total : null;
  const invitations =
    invitationsResult.status === 'fulfilled' ? invitationsResult.value : null;

  const loadError =
    access === null ||
    legalEntities === null ||
    datasets === null ||
    memberTotal === null ||
    invitations === null;

  const entityCount = legalEntities?.length ?? 0;
  const datasetCount = datasets?.length ?? 0;
  const memberCount = memberTotal ?? 0;
  const pendingInvitations =
    invitations?.filter((invitation) => invitation.status === 'pending')
      .length ?? 0;

  // Capabilities fail closed, so a failed access read renders no next steps.
  const canCreateEntities = access?.capabilities.createEntities ?? false;
  const canManageMembers = access?.capabilities.manageMembers ?? false;
  const canUploadData = access?.capabilities.uploadData ?? false;

  const showCreateEntity = entityCount === 0 && canCreateEntities;
  const showInviteMembers = memberCount === 1 && canManageMembers;
  const showUploadData = datasetCount === 0 && canUploadData;
  const showNextSteps = showCreateEntity || showInviteMembers || showUploadData;

  const i18n = await createServerI18n();
  const t = i18n.t.bind(i18n);

  const membersHref = `/${organization.slug}/members`;
  const invitationsHref = `${membersHref}?tab=invitations`;
  const entitiesHref = `/${organization.slug}/entities`;
  const settingsHref = `/${organization.slug}/settings`;

  return (
    <PageContainer>
      <Stack gap={3}>
        <h1>{organization.name}</h1>
        <Stack gap={4} orientation="horizontal">
          <span>{organization.slug}</span>
          <Tag type="cool-gray">{t(roleLabelKey(organization.role))}</Tag>
        </Stack>
      </Stack>

      {loadError ? (
        <InlineNotification
          hideCloseButton
          kind="error"
          lowContrast
          title={t('landing.loadError')}
        />
      ) : null}

      <Grid narrow>
        <Column lg={4} md={4} sm={2}>
          <ClickableTile href={membersHref}>
            <p>{t('landing.tiles.members')}</p>
            <p>
              {t('landing.tiles.membersValue', {
                count: memberCount,
                limit: organizationCreationConfiguration.membershipLimit,
              })}
            </p>
          </ClickableTile>
        </Column>
        <Column lg={4} md={4} sm={2}>
          <ClickableTile href={invitationsHref}>
            <p>{t('landing.tiles.invitations')}</p>
            <p>{pendingInvitations}</p>
          </ClickableTile>
        </Column>
        <Column lg={4} md={4} sm={2}>
          <ClickableTile href={entitiesHref}>
            <p>{t('landing.tiles.entities')}</p>
            <p>{entityCount}</p>
          </ClickableTile>
        </Column>
        <Column lg={4} md={4} sm={2}>
          <ClickableTile href="/documents">
            <p>{t('landing.tiles.documents')}</p>
          </ClickableTile>
        </Column>
        <Column lg={4} md={4} sm={2}>
          <ClickableTile href="/datasets">
            <p>{t('landing.tiles.datasets')}</p>
          </ClickableTile>
        </Column>
        <Column lg={4} md={4} sm={2}>
          <ClickableTile href={settingsHref}>
            <p>{t('landing.tiles.settings')}</p>
          </ClickableTile>
        </Column>
      </Grid>

      {showNextSteps ? (
        <Stack gap={4}>
          <h2>{t('landing.nextSteps.title')}</h2>
          <Stack gap={3}>
            {showCreateEntity ? (
              <Link href={entitiesHref}>
                {t('landing.nextSteps.createEntity')}
              </Link>
            ) : null}
            {showInviteMembers ? (
              <Link href={invitationsHref}>
                {t('landing.nextSteps.inviteMembers')}
              </Link>
            ) : null}
            {showUploadData ? (
              <Link href="/datasets">{t('landing.nextSteps.uploadData')}</Link>
            ) : null}
          </Stack>
        </Stack>
      ) : null}
    </PageContainer>
  );
}
