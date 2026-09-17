'use client';

import {
  AiGenerate,
  DataSet,
  Logout,
  Security,
  Upload,
  UserMultiple,
} from '@bap/design-system/icons';
import {
  Button,
  Column,
  Grid,
  InlineLoading,
  InlineNotification,
  Select,
  SelectItem,
  Stack,
  Tile,
} from '@bap/design-system/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import PageContainer from '../../../../components/page-container';
import { authClient } from '../../../../lib/auth/client';
import { organizationAccessSchema } from '../../../../lib/datasets/client';

const organizationsSchema = z.array(
  z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    slug: z.string().min(1),
  }),
);
// The shared capability gate, plus the scope, role and service only this page reads.
const accessSchema = organizationAccessSchema.extend({
  entityScope: z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('all') }),
    z.object({
      legalEntityIds: z.array(z.string().min(1)),
      mode: z.literal('restricted'),
    }),
  ]),
  role: z.enum(['owner', 'admin', 'member']),
  service: z.enum(['application-api', 'reporting-api']),
});

// The ten capabilities are listed in one fixed order, whatever the role holds.
const capabilityNames = [
  'manageOrganization',
  'manageMembers',
  'manageEntityAccess',
  'createEntities',
  'updateEntities',
  'deleteEntities',
  'uploadData',
  'readDocuments',
  'manageDocuments',
  'useAi',
] as const;

type AccessResult = z.infer<typeof accessSchema>;
type Organization = z.infer<typeof organizationsSchema>[number];

async function getJson(path: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(path, { cache: 'no-store', signal });
  if (!response.ok) {
    throw new Error('Request failed.');
  }
  return await response.json();
}

export default function AccessPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [organizationId, setOrganizationId] = useState('');
  const [applicationAccess, setApplicationAccess] = useState<AccessResult>();
  const [reportingAccess, setReportingAccess] = useState<AccessResult>();
  const [state, setState] = useState<'error' | 'idle' | 'loading'>('loading');

  useEffect(() => {
    const controller = new AbortController();
    void getJson('/api/auth/organization/list', controller.signal)
      .then((payload) => organizationsSchema.parse(payload))
      .then((items) => {
        setOrganizations(items);
        setOrganizationId(items[0]?.id ?? '');
        setState(items.length > 0 ? 'loading' : 'idle');
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          setState('error');
        }
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!organizationId) {
      return;
    }
    const controller = new AbortController();
    void Promise.all([
      getJson(
        `/api/bff/application/organizations/${encodeURIComponent(organizationId)}/access`,
        controller.signal,
      ).then((payload) => accessSchema.parse(payload)),
      getJson(
        `/api/bff/reporting/organizations/${encodeURIComponent(organizationId)}/access`,
        controller.signal,
      ).then((payload) => accessSchema.parse(payload)),
    ])
      .then(([application, reporting]) => {
        if (
          application.organizationId !== organizationId ||
          application.service !== 'application-api' ||
          reporting.organizationId !== organizationId ||
          reporting.service !== 'reporting-api'
        ) {
          throw new Error('Organization mismatch.');
        }
        setApplicationAccess(application);
        setReportingAccess(reporting);
        setState('idle');
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          setApplicationAccess(undefined);
          setReportingAccess(undefined);
          setState('error');
        }
      });
    return () => controller.abort();
  }, [organizationId]);

  async function signOut(): Promise<void> {
    await authClient.signOut();
    router.push('/sign-in');
  }

  function selectOrganization(id: string): void {
    setApplicationAccess(undefined);
    setOrganizationId(id);
    setReportingAccess(undefined);
    setState('loading');
  }

  const empty = state === 'idle' && organizations.length === 0;
  const selectedOrganization = organizations.find(
    (organization) => organization.id === organizationId,
  );

  return (
    <PageContainer>
      <h1>{t('access.title')}</h1>
      <Button
        kind="secondary"
        onClick={() => void signOut()}
        renderIcon={Logout}
        type="button"
      >
        {t('common.signOut')}
      </Button>
      <Button href="/datasets" kind="tertiary" renderIcon={DataSet}>
        {t('access.datasets')}
      </Button>
      {state === 'loading' ? (
        <InlineLoading description={t('access.loading')} />
      ) : null}
      {state === 'error' ? (
        <InlineNotification
          kind="error"
          lowContrast
          role="alert"
          subtitle={t('access.error')}
          title={t('access.denied')}
        />
      ) : null}
      {empty ? (
        <InlineNotification kind="info" lowContrast title={t('access.empty')} />
      ) : null}
      {organizations.length > 0 ? (
        <Select
          id="organization"
          labelText={t('access.organization')}
          onChange={(event) => selectOrganization(event.target.value)}
          value={organizationId}
        >
          {organizations.map((organization) => (
            <SelectItem
              key={organization.id}
              text={organization.name}
              value={organization.id}
            />
          ))}
        </Select>
      ) : null}
      {applicationAccess && reportingAccess ? (
        <Tile>
          <Stack gap={5}>
            <p>
              {t('access.application')}: {applicationAccess.role}
            </p>
            <p>
              {t('access.reporting')}: {reportingAccess.role}
            </p>
            <h2>{t('access.capabilities')}</h2>
            <ul>
              {capabilityNames.map((capability) => (
                <li key={capability}>
                  {t(`access.${capability}`)}:{' '}
                  {applicationAccess.capabilities[capability]
                    ? t('access.capabilityAllowed')
                    : t('access.capabilityDenied')}
                </li>
              ))}
            </ul>
            <p>
              {t('access.entityScope')}:{' '}
              {applicationAccess.entityScope.mode === 'all'
                ? t('access.entityScopeAll')
                : t('access.entityScopeRestricted', {
                    count: applicationAccess.entityScope.legalEntityIds.length,
                  })}
            </p>
            <h2>{t('access.actions')}</h2>
            {/* Capabilities only choose which actions are offered, the database enforces access. */}
            <Grid>
              {applicationAccess.capabilities.manageMembers &&
              selectedOrganization ? (
                <Column lg={4} md={4} sm={4}>
                  <Button
                    href={`/${encodeURIComponent(selectedOrganization.slug)}/members`}
                    kind="tertiary"
                    renderIcon={UserMultiple}
                    size="lg"
                  >
                    {t('access.manageMembers')}
                  </Button>
                </Column>
              ) : null}
              {applicationAccess.capabilities.manageEntityAccess &&
              selectedOrganization ? (
                <Column lg={4} md={4} sm={4}>
                  <Button
                    href={`/${encodeURIComponent(selectedOrganization.slug)}/members`}
                    kind="tertiary"
                    renderIcon={Security}
                    size="lg"
                  >
                    {t('access.manageEntityAccess')}
                  </Button>
                </Column>
              ) : null}
              {(applicationAccess.capabilities.createEntities ||
                applicationAccess.capabilities.updateEntities ||
                applicationAccess.capabilities.manageEntityAccess) &&
              selectedOrganization ? (
                <Column lg={4} md={4} sm={4}>
                  <Button
                    href={`/${encodeURIComponent(selectedOrganization.slug)}/entities`}
                    kind="tertiary"
                    renderIcon={DataSet}
                    size="lg"
                  >
                    {t('access.manageEntities')}
                  </Button>
                </Column>
              ) : null}
              {applicationAccess.capabilities.uploadData &&
              selectedOrganization ? (
                <Column lg={4} md={4} sm={4}>
                  <Button
                    href={`/datasets?organization=${encodeURIComponent(selectedOrganization.slug)}#upload-dataset`}
                    kind="tertiary"
                    renderIcon={Upload}
                    size="lg"
                  >
                    {t('access.uploadData')}
                  </Button>
                </Column>
              ) : null}
              {applicationAccess.capabilities.useAi && selectedOrganization ? (
                <Column lg={4} md={4} sm={4}>
                  <Button
                    href={`/datasets?organization=${encodeURIComponent(selectedOrganization.slug)}`}
                    kind="tertiary"
                    renderIcon={AiGenerate}
                    size="lg"
                  >
                    {t('access.useAi')}
                  </Button>
                </Column>
              ) : null}
            </Grid>
          </Stack>
        </Tile>
      ) : null}
    </PageContainer>
  );
}
