'use client';
import {
  Button,
  InlineNotification,
  Select,
  SelectItem,
  Stack,
} from '@bap/design-system/react';
import { DataGrid } from '@bap/design-system/blocks';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import PageContainer from '../../../components/page-container';
import { getJson } from '../../../lib/datasets/client';
import { employeesPath, withOrganization } from '../../../lib/hr/client';
import { employeeListSchema } from '../../../lib/hr/contract';
import { useOrganizationSelection } from '../../../lib/organizations/use-organization-selection';
import { useOrganizationAccess } from '../../../lib/organizations/use-organization-access';
import { useLegalEntities } from '../../../lib/organizations/use-legal-entities';
export default function EmployeesPage() {
  const { t } = useTranslation();
  const organization = useOrganizationSelection();
  const { access } = useOrganizationAccess(organization.organizationId);
  const entities = useLegalEntities(organization.organizationId);
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const page = Number(searchParams.get('page') ?? '1');
  const pageSize = Number(searchParams.get('pageSize') ?? '25');
  const legalEntityId = searchParams.get('legalEntityId') ?? '';
  const query = searchParams.get('q') ?? '';
  const [employees, setEmployees] = useState<
    (typeof employeeListSchema._output)['employees']
  >([]);
  const [total, setTotal] = useState(0);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  useEffect(() => {
    if (!organization.organizationId || !access?.capabilities.readHr) return;
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
    });
    if (legalEntityId) params.set('legalEntityId', legalEntityId);
    if (query) params.set('q', query);
    void getJson(
      employeesPath(organization.organizationId, params),
      new AbortController().signal,
    )
      .then((x) => employeeListSchema.parse(x))
      .then((x) => {
        setEmployees(x.employees);
        setTotal(x.total);
        setState('ready');
      })
      .catch(() => setState('error'));
  }, [
    access?.capabilities.readHr,
    organization.organizationId,
    page,
    pageSize,
    legalEntityId,
    query,
  ]);
  const update = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.set('page', '1');
    router.replace(`${pathname}?${next.toString()}` as never);
  };
  const rows = useMemo(
    () =>
      employees.map((e) => ({
        id: e.id,
        employeeNumber: e.employeeNumber,
        name: `${e.firstName} ${e.lastName}`,
        status: e.status,
      })),
    [employees],
  );
  return (
    <PageContainer>
      <Stack gap={6}>
        {access?.capabilities.manageHr && (
          <Button
            as={Link}
            href={
              withOrganization('/employees/new', organization.slug) as never
            }
          >
            {t('employees.new')}
          </Button>
        )}
        {access !== undefined && !access.capabilities.readHr && (
          <InlineNotification
            kind="error"
            title={t('employees.denied')}
            hideCloseButton
          />
        )}
        {access?.capabilities.readHr && (
          <>
            <Select
              id="employee-entity"
              labelText={t('employees.legalEntity')}
              value={legalEntityId}
              onChange={(e) => update('legalEntityId', e.target.value)}
            >
              <SelectItem value="" text={t('employees.allEntities')} />
              {entities.map((entity) => (
                <SelectItem
                  key={entity.id}
                  value={entity.id}
                  text={entity.name}
                />
              ))}
            </Select>
            <DataGrid
              columns={[
                {
                  key: 'employeeNumber',
                  header: t('employees.employeeNumber'),
                },
                { key: 'name', header: t('employees.name') },
                { key: 'status', header: t('employees.status') },
              ]}
              rows={rows}
              search
              searchValue={query}
              onSearch={(value) => update('q', value)}
              pagination
              paginationMode="server"
              page={page}
              pageSize={pageSize}
              totalItems={total}
              onPageChange={(next, size) => {
                const nextParams = new URLSearchParams(searchParams.toString());
                nextParams.set('page', String(next));
                nextParams.set('pageSize', String(size));
                router.replace(`${pathname}?${nextParams.toString()}` as never);
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
              emptyLabel={t('employees.empty')}
              errorLabel={t('employees.error')}
              onRowClick={(row) =>
                router.push(
                  withOrganization(
                    `/employees/${row.id}`,
                    organization.slug,
                  ) as never,
                )
              }
            />
          </>
        )}
      </Stack>
    </PageContainer>
  );
}
