'use client';

import { DataGrid } from '@bap/design-system/blocks';
import { Heading, InlineNotification, Stack } from '@bap/design-system/react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { getJson } from '../../../lib/datasets/client';
import { employeesPath, withOrganization } from '../../../lib/hr/client';
import { employeeListSchema } from '../../../lib/hr/contract';
import { identifierSchema } from '../../../lib/hr-time/contract';
import { useOrganizationAccess } from '../../../lib/organizations/use-organization-access';
import { useOrganizationSelection } from '../../../lib/organizations/use-organization-selection';
import { LeaveRecordsPage } from './leave-records-page';
import { TimeRecordsPage } from './time-records-page';

export function TeamTimePage({
  mode,
  title,
}: Readonly<{
  mode: 'overview' | 'timesheets' | 'approvals' | 'leave' | 'calendar';
  title: string;
}>) {
  const { t } = useTranslation();
  const organization = useOrganizationSelection();
  const { access, state } = useOrganizationAccess(organization.organizationId);
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const employeeId = searchParams.get('employeeId');
  const selectedEmployeeId = identifierSchema.safeParse(employeeId);
  const [employees, setEmployees] =
    useState<(typeof employeeListSchema._output)['employees']>();
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>(
    'loading',
  );
  useEffect(() => {
    if (
      mode === 'overview' ||
      !organization.organizationId ||
      !access?.capabilities.readHr
    )
      return;
    const controller = new AbortController();
    void getJson(
      employeesPath(
        organization.organizationId,
        new URLSearchParams({ page: '1', pageSize: '100' }),
      ),
      controller.signal,
    )
      .then((value) => employeeListSchema.parse(value))
      .then((value) => {
        if (!controller.signal.aborted) {
          setEmployees(value.employees);
          setLoadState('ready');
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoadState('error');
      });
    return () => controller.abort();
  }, [access?.capabilities.readHr, mode, organization.organizationId]);
  if (organization.state === 'error' || state === 'error')
    return (
      <>
        <InlineNotification
          kind="error"
          title={t('time.accessError')}
          hideCloseButton
        />
      </>
    );
  if (
    organization.state === 'loading' ||
    state === 'loading' ||
    access === undefined
  )
    return (
      <>
        <InlineNotification
          kind="info"
          title={t('employees.loading')}
          hideCloseButton
        />
      </>
    );
  if (!access.capabilities.readHr)
    return (
      <>
        <InlineNotification
          kind="error"
          title={t('time.denied')}
          hideCloseButton
        />
      </>
    );
  if (mode === 'overview')
    return (
      <>
        <Stack gap={5}>
          <Heading>{title}</Heading>
          <Link
            href={
              withOrganization('/time/timesheets', organization.slug) as never
            }
          >
            {t('time.timesheets')}
          </Link>
          <Link
            href={
              withOrganization('/time/approvals', organization.slug) as never
            }
          >
            {t('time.approvals')}
          </Link>
          <Link
            href={withOrganization('/time/leave', organization.slug) as never}
          >
            {t('time.leave')}
          </Link>
          <Link
            href={
              withOrganization('/time/calendar', organization.slug) as never
            }
          >
            {t('time.calendar')}
          </Link>
        </Stack>
      </>
    );
  if (selectedEmployeeId.success)
    return mode === 'leave' ? (
      <LeaveRecordsPage employeeId={selectedEmployeeId.data} title={title} />
    ) : (
      <TimeRecordsPage
        employeeId={selectedEmployeeId.data}
        title={title}
        mode={mode}
      />
    );
  return (
    <>
      <Stack gap={5}>
        <Heading>{title}</Heading>
        <InlineNotification
          kind="info"
          title={t('time.selectEmployee')}
          hideCloseButton
        />
        <DataGrid
          state={
            loadState === 'loading'
              ? 'loading'
              : loadState === 'error'
                ? 'error'
                : !employees?.length
                  ? 'empty'
                  : 'ready'
          }
          emptyLabel={t('employees.empty')}
          errorLabel={t('employees.error')}
          columns={[
            { key: 'employeeNumber', header: t('employees.employeeNumber') },
            { key: 'name', header: t('employees.name') },
          ]}
          rows={(employees ?? []).map((employee) => ({
            id: employee.id,
            employeeNumber: employee.employeeNumber,
            name: `${employee.firstName} ${employee.lastName}`,
          }))}
          rowActions={(row) => [
            {
              id: 'view',
              label: t('time.view'),
              onClick: () => {
                const query = new URLSearchParams();
                query.set('employeeId', row.id);
                if (organization.slug)
                  query.set('organization', organization.slug);
                router.push(`${pathname}?${query}` as never);
              },
            },
          ]}
        />
      </Stack>
    </>
  );
}
