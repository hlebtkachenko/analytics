'use client';

import {
  Button,
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

import { authClient } from '../../lib/auth/client';

const organizationsSchema = z.array(
  z.object({
    id: z.string().min(1),
    name: z.string().min(1),
  }),
);
const accessSchema = z.object({
  organizationId: z.string().min(1),
  role: z.enum(['owner', 'admin', 'member']),
  service: z.enum(['application-api', 'reporting-api']),
});

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

  return (
    <main>
      <Stack gap={7}>
        <h1>{t('access.title')}</h1>
        <Button kind="secondary" onClick={() => void signOut()} type="button">
          {t('common.signOut')}
        </Button>
        {state === 'loading' ? (
          <InlineLoading description={t('access.loading')} />
        ) : null}
        {state === 'error' ? (
          <InlineNotification
            kind="error"
            lowContrast
            subtitle={t('access.error')}
            title={t('access.denied')}
          />
        ) : null}
        {empty ? (
          <InlineNotification
            kind="info"
            lowContrast
            title={t('access.empty')}
          />
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
            </Stack>
          </Tile>
        ) : null}
      </Stack>
    </main>
  );
}
