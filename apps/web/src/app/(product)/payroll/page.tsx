'use client';
import {
  Button,
  InlineNotification,
  Select,
  SelectItem,
  Stack,
  TextInput,
} from '@bap/design-system/react';
import { DataGrid } from '@bap/design-system/blocks';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import PageContainer from '../../../components/page-container';
import { getJson } from '../../../lib/datasets/client';
import { withOrganization } from '../../../lib/hr/client';
import { payrollRunsPath } from '../../../lib/payroll/client';
import { payrollRunListSchema } from '../../../lib/payroll/contract';
import { useOrganizationSelection } from '../../../lib/organizations/use-organization-selection';
import { useOrganizationAccess } from '../../../lib/organizations/use-organization-access';
import { useLegalEntities } from '../../../lib/organizations/use-legal-entities';
export default function PayrollPage() {
  const { t } = useTranslation();
  const organization = useOrganizationSelection();
  const { access, state: accessState } = useOrganizationAccess(
    organization.organizationId,
  );
  const entities = useLegalEntities(organization.organizationId);
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const parsePositive = (
    value: string | null,
    maximum: number,
    fallback: number,
  ) => {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 1 && parsed <= maximum
      ? parsed
      : fallback;
  };
  const validMonth = /^\d{4}-(0[1-9]|1[0-2])$/;
  const page = parsePositive(search.get('page'), Number.MAX_SAFE_INTEGER, 1);
  const pageSize = parsePositive(search.get('pageSize'), 100, 25);
  const legalEntityId = search.get('legalEntityId') ?? '';
  const month = validMonth.test(search.get('month') ?? '')
    ? search.get('month')!
    : '';
  const [data, setData] = useState<typeof payrollRunListSchema._output>();
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const canRead = access?.capabilities.readPayroll;
  useEffect(() => {
    if (
      organization.state === 'loading' ||
      organization.state === 'error' ||
      access?.capabilities.readPayroll !== true
    )
      return;
    const controller = new AbortController();
    const q = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
    });
    if (legalEntityId) q.set('legalEntityId', legalEntityId);
    if (month) q.set('month', month);
    void getJson(
      payrollRunsPath(organization.organizationId, q),
      controller.signal,
    )
      .then((x) => payrollRunListSchema.parse(x))
      .then((x) => {
        if (!controller.signal.aborted) {
          setData(x);
          setState('ready');
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setState('error');
      });
    return () => controller.abort();
  }, [
    organization.organizationId,
    access?.capabilities.readPayroll,
    page,
    pageSize,
    legalEntityId,
    month,
    organization.state,
  ]);
  const update = (key: string, value: string) => {
    const q = new URLSearchParams(search.toString());
    if (value) q.set(key, value);
    else q.delete(key);
    if (key !== 'page') q.set('page', '1');
    router.replace(`${pathname}?${q.toString()}` as never);
  };
  const rows = useMemo(
    () =>
      data?.payrollRuns.map((run) => ({
        id: run.id,
        month: run.month,
        version: `v${run.version}`,
        status: run.status,
        origin: run.origin,
        results: String(run.results.length),
      })) ?? [],
    [data],
  );
  if (organization.state === 'error' || accessState === 'error') {
    return (
      <PageContainer>
        <InlineNotification
          kind="error"
          title={t('payroll.accessError')}
          hideCloseButton
        />
      </PageContainer>
    );
  }
  if (
    organization.state === 'loading' ||
    accessState === 'loading' ||
    access === undefined
  )
    return (
      <PageContainer>
        <InlineNotification
          kind="info"
          title={t('payroll.loading')}
          hideCloseButton
        />
      </PageContainer>
    );
  return (
    <PageContainer>
      <Stack gap={5}>
        {canRead && (
          <>
            <Select
              id="payroll-entity"
              labelText={t('payroll.legalEntity')}
              value={legalEntityId}
              onChange={(e) => update('legalEntityId', e.target.value)}
            >
              <SelectItem value="" text={t('payroll.allEntities')} />
              {entities.map((e) => (
                <SelectItem key={e.id} value={e.id} text={e.name} />
              ))}
            </Select>
            <TextInput
              id="payroll-month"
              labelText={t('payroll.month')}
              type="month"
              value={month}
              onChange={(e) => update('month', e.target.value)}
            />
            <DataGrid
              columns={[
                { key: 'month', header: t('payroll.month') },
                { key: 'version', header: t('payroll.version') },
                { key: 'status', header: t('payroll.status') },
                { key: 'origin', header: t('payroll.origin') },
                { key: 'results', header: t('payroll.resultCount') },
              ]}
              rows={rows}
              pagination
              paginationMode="server"
              page={page}
              pageSize={pageSize}
              totalItems={data?.total ?? 0}
              onPageChange={(next, size) => {
                const q = new URLSearchParams(search.toString());
                q.set('page', String(next));
                q.set('pageSize', String(size));
                router.replace(`${pathname}?${q.toString()}` as never);
              }}
              state={
                state === 'error'
                  ? 'error'
                  : state === 'loading'
                    ? 'loading'
                    : rows.length === 0
                      ? 'empty'
                      : 'ready'
              }
              emptyLabel={t('payroll.empty')}
              errorLabel={t('payroll.error')}
              onRowClick={(row) =>
                router.push(
                  withOrganization(
                    `/payroll/${row.id}`,
                    organization.slug,
                  ) as never,
                )
              }
            />
            {access.capabilities.managePayroll && (
              <Button
                as={Link}
                href={
                  withOrganization('/payroll/new', organization.slug) as never
                }
              >
                {t('payroll.new')}
              </Button>
            )}
            {access.capabilities.managePayroll && (
              <Button
                as={Link}
                kind="secondary"
                href={
                  withOrganization(
                    '/payroll/import',
                    organization.slug,
                  ) as never
                }
              >
                {t('payroll.import')}
              </Button>
            )}
          </>
        )}
        {access !== undefined && !canRead && (
          <InlineNotification
            kind="error"
            title={t('payroll.denied')}
            hideCloseButton
          />
        )}
      </Stack>
    </PageContainer>
  );
}
