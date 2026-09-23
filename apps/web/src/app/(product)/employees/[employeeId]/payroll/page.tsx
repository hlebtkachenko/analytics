'use client';

import { DataGrid } from '@bap/design-system/blocks';
import {
  Heading,
  InlineNotification,
  Stack,
  TextInput,
} from '@bap/design-system/react';
import Link from 'next/link';
import {
  useParams,
  usePathname,
  useRouter,
  useSearchParams,
} from 'next/navigation';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import PageContainer from '../../../../../components/page-container';
import { getJson } from '../../../../../lib/datasets/client';
import { withOrganization } from '../../../../../lib/hr/client';
import { employeePayrollResultsPath } from '../../../../../lib/payroll/client';
import { employeePayrollResultListSchema } from '../../../../../lib/payroll/contract';
import { useOrganizationAccess } from '../../../../../lib/organizations/use-organization-access';
import { useOrganizationSelection } from '../../../../../lib/organizations/use-organization-selection';
import { EmployeeTabs } from '../employee-tabs';

const month = /^\d{4}-(0[1-9]|1[0-2])$/;
const pageNumber = (value: string | null, max = Number.POSITIVE_INFINITY) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= max ? parsed : 1;
};

export default function EmployeePayrollPage() {
  const { t } = useTranslation();
  const { employeeId } = useParams<{ employeeId: string }>();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const organization = useOrganizationSelection();
  const { access, state: accessState } = useOrganizationAccess(
    organization.organizationId,
  );
  const fromMonth = month.test(searchParams.get('fromMonth') ?? '')
    ? searchParams.get('fromMonth')!
    : '';
  const toMonth = month.test(searchParams.get('toMonth') ?? '')
    ? searchParams.get('toMonth')!
    : '';
  const page = pageNumber(searchParams.get('page'));
  const pageSize = pageNumber(searchParams.get('pageSize'), 100);
  const [results, setResults] = useState<
    typeof employeePayrollResultListSchema._output | undefined
  >();
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  const replace = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
    }
    router.replace(`${pathname}?${next}` as never);
  };

  useEffect(() => {
    if (
      organization.state !== 'idle' ||
      accessState !== 'idle' ||
      !organization.organizationId ||
      !access?.capabilities.readPayroll
    )
      return;
    const controller = new AbortController();
    const query = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
    });
    if (fromMonth) query.set('fromMonth', fromMonth);
    if (toMonth) query.set('toMonth', toMonth);
    void Promise.resolve()
      .then(() => {
        if (controller.signal.aborted) return undefined;
        setResults(undefined);
        setState('loading');
        return getJson(
          employeePayrollResultsPath(
            organization.organizationId,
            employeeId,
            query,
          ),
          controller.signal,
        );
      })
      .then((value) => employeePayrollResultListSchema.parse(value))
      .then((value) => {
        if (!controller.signal.aborted) {
          setResults(value);
          setState('ready');
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setState('error');
      });
    return () => controller.abort();
  }, [
    access?.capabilities.readPayroll,
    accessState,
    employeeId,
    fromMonth,
    organization.organizationId,
    organization.state,
    page,
    pageSize,
    toMonth,
  ]);

  return (
    <PageContainer>
      <Stack gap={5}>
        <EmployeeTabs />
        <Heading>{t('employees.payroll')}</Heading>
        {organization.state === 'error' || accessState === 'error' ? (
          <InlineNotification
            kind="error"
            title={t('employees.accessError')}
            hideCloseButton
          />
        ) : organization.state === 'loading' || accessState === 'loading' ? (
          <DataGrid columns={[]} rows={[]} state="loading" />
        ) : !access?.capabilities.readPayroll ? (
          <InlineNotification
            kind="error"
            title={t('payroll.denied')}
            hideCloseButton
          />
        ) : (
          <>
            <Stack gap={3} orientation="horizontal">
              <TextInput
                id="fromMonth"
                labelText={t('employees.effectiveFrom')}
                type="month"
                value={fromMonth}
                onChange={(event) =>
                  replace({ fromMonth: event.target.value, page: '1' })
                }
              />
              <TextInput
                id="toMonth"
                labelText={t('employees.effectiveTo')}
                type="month"
                value={toMonth}
                onChange={(event) =>
                  replace({ toMonth: event.target.value, page: '1' })
                }
              />
            </Stack>
            <DataGrid
              state={
                state === 'loading'
                  ? 'loading'
                  : state === 'error'
                    ? 'error'
                    : !results || results.payrollResults.length === 0
                      ? 'empty'
                      : 'ready'
              }
              emptyLabel={t('employees.payrollEmpty')}
              errorLabel={t('employees.payrollError')}
              columns={[
                { key: 'month', header: t('payroll.month') },
                { key: 'version', header: t('payroll.version') },
                { key: 'status', header: t('employees.status') },
                {
                  key: 'grossPay',
                  header: t('payroll.grossPay'),
                  align: 'end',
                },
                { key: 'netPay', header: t('payroll.netPay'), align: 'end' },
                {
                  key: 'totalEmployerCost',
                  header: t('payroll.totalEmployerCost'),
                  align: 'end',
                },
                {
                  key: 'payslipDocumentId',
                  header: t('employees.payslip'),
                  renderCell: (row) =>
                    row.payslipDocumentId ? (
                      <Link
                        href={
                          withOrganization(
                            `/documents/${encodeURIComponent(String(row.payslipDocumentId))}`,
                            organization.slug,
                          ) as never
                        }
                      >
                        {t('employees.payslip')}
                      </Link>
                    ) : (
                      ''
                    ),
                },
              ]}
              rows={(results?.payrollResults ?? []).map((result) => ({
                id: result.payrollRunId,
                month: result.month,
                version: result.version,
                status: result.status,
                grossPay: result.grossPay,
                netPay: result.netPay,
                totalEmployerCost: result.totalEmployerCost,
                payslipDocumentId: result.payslipDocumentId,
              }))}
              pagination
              paginationMode="server"
              page={results?.page ?? page}
              pageSize={results?.pageSize ?? pageSize}
              totalItems={results?.total ?? 0}
              onPageChange={(next, size) =>
                replace({ page: String(next), pageSize: String(size) })
              }
            />
          </>
        )}
      </Stack>
    </PageContainer>
  );
}
