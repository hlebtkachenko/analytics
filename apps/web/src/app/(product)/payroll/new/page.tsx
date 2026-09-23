'use client';
import {
  Button,
  Form,
  InlineNotification,
  Select,
  SelectItem,
  Stack,
  TextInput,
} from '@bap/design-system/react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import PageContainer from '../../../../components/page-container';
import { getJson } from '../../../../lib/datasets/client';
import { employeesPath, withOrganization } from '../../../../lib/hr/client';
import { employeeListSchema } from '../../../../lib/hr/contract';
import { payrollRunSchema } from '../../../../lib/payroll/contract';
import {
  payrollRunsPath,
  postPayrollJson,
} from '../../../../lib/payroll/client';
import { useOrganizationSelection } from '../../../../lib/organizations/use-organization-selection';
import { useLegalEntities } from '../../../../lib/organizations/use-legal-entities';
import { useOrganizationAccess } from '../../../../lib/organizations/use-organization-access';
type Row = {
  employeeId: string;
  grossPay: string;
  employeeSocial: string;
  employeeHealth: string;
  incomeTax: string;
  otherDeductions: string;
  netPay: string;
  employerSocial: string;
  employerHealth: string;
  totalEmployerCost: string;
};
const blank = (): Row => ({
  employeeId: '',
  grossPay: '',
  employeeSocial: '0',
  employeeHealth: '0',
  incomeTax: '0',
  otherDeductions: '0',
  netPay: '',
  employerSocial: '0',
  employerHealth: '0',
  totalEmployerCost: '',
});
const money = /^\d{1,15}(\.\d{1,4})?$/;
const moneyScale = 10_000n;
const moneyUnits = (value: string) => {
  const [whole = '0', fraction = ''] = value.split('.');
  return BigInt(whole) * moneyScale + BigInt((fraction + '0000').slice(0, 4));
};
function arithmeticError(row: Row) {
  if (
    ![
      row.grossPay,
      row.employeeSocial,
      row.employeeHealth,
      row.incomeTax,
      row.otherDeductions,
      row.netPay,
      row.employerSocial,
      row.employerHealth,
      row.totalEmployerCost,
    ].every((v) => money.test(v))
  )
    return true;
  return (
    moneyUnits(row.grossPay) -
      moneyUnits(row.employeeSocial) -
      moneyUnits(row.employeeHealth) -
      moneyUnits(row.incomeTax) -
      moneyUnits(row.otherDeductions) !==
      moneyUnits(row.netPay) ||
    moneyUnits(row.grossPay) +
      moneyUnits(row.employerSocial) +
      moneyUnits(row.employerHealth) !==
      moneyUnits(row.totalEmployerCost)
  );
}
export default function NewPayrollPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const organization = useOrganizationSelection();
  const entities = useLegalEntities(organization.organizationId);
  const { access, state: accessState } = useOrganizationAccess(
    organization.organizationId,
  );
  const [entityId, setEntityId] = useState('');
  const [employees, setEmployees] = useState<
    (typeof employeeListSchema._output)['employees']
  >([]);
  const [rows, setRows] = useState<Row[]>([blank()]);
  const [error, setError] = useState(false);
  const [rowError, setRowError] = useState(false);
  const [employeeState, setEmployeeState] = useState<
    'idle' | 'loading' | 'error' | 'ready'
  >('idle');
  const formRef = useRef<HTMLFormElement>(null);
  const idempotencyKey = useRef(crypto.randomUUID());
  useEffect(() => {
    if (
      organization.state === 'loading' ||
      organization.state === 'error' ||
      !organization.organizationId ||
      !entityId ||
      access?.capabilities.managePayroll !== true
    )
      return;
    const controller = new AbortController();
    void (async () => {
      try {
        const all: (typeof employeeListSchema._output)['employees'][number][] =
          [];
        let total = 0;
        for (let page = 1; page <= 10; page += 1) {
          const p = new URLSearchParams({
            legalEntityId: entityId,
            page: String(page),
            pageSize: '100',
          });
          const result = employeeListSchema.parse(
            await getJson(
              employeesPath(organization.organizationId, p),
              controller.signal,
            ),
          );
          all.push(...result.employees);
          total = result.total;
          if (all.length >= total || result.employees.length === 0) break;
        }
        if (!controller.signal.aborted) {
          setEmployees(all);
          setEmployeeState('ready');
        }
      } catch {
        if (!controller.signal.aborted) {
          setEmployees([]);
          setEmployeeState('error');
        }
      }
    })();
    return () => controller.abort();
  }, [
    access?.capabilities.managePayroll,
    organization.organizationId,
    organization.state,
    entityId,
  ]);
  const reset = () => {
    formRef.current?.reset();
    setEntityId('');
    setEmployees([]);
    setEmployeeState('idle');
    setRows([blank()]);
    setError(false);
    setRowError(false);
    idempotencyKey.current = crypto.randomUUID();
  };
  if (organization.state === 'error' || accessState === 'error')
    return (
      <PageContainer>
        <InlineNotification
          kind="error"
          title={t('payroll.accessError')}
          hideCloseButton
        />
      </PageContainer>
    );
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
  if (!access?.capabilities.managePayroll)
    return (
      <PageContainer>
        <InlineNotification
          kind="error"
          title={t('payroll.denied')}
          hideCloseButton
        />
      </PageContainer>
    );
  const update = (i: number, key: keyof Row, value: string) =>
    setRows((current) =>
      current.map((row, n) => (n === i ? { ...row, [key]: value } : row)),
    );
  return (
    <PageContainer>
      <Form
        ref={formRef}
        onSubmit={(event) => {
          event.preventDefault();
          setError(false);
          const ids = rows.map((r) => r.employeeId);
          if (
            rows.length < 1 ||
            rows.length > 1000 ||
            ids.some((id, i) => !id || ids.indexOf(id) !== i) ||
            rows.some(arithmeticError)
          ) {
            setRowError(true);
            return;
          }
          setRowError(false);
          const data = new FormData(event.currentTarget);
          void postPayrollJson(
            payrollRunsPath(organization.organizationId),
            {
              legalEntityId: entityId,
              month: data.get('month'),
              results: rows,
            },
            payrollRunSchema,
            idempotencyKey.current,
          )
            .then((run) => {
              idempotencyKey.current = crypto.randomUUID();
              router.push(
                withOrganization(
                  `/payroll/${run.id}`,
                  organization.slug,
                ) as never,
              );
            })
            .catch(() => setError(true));
        }}
      >
        <Stack gap={5}>
          {error && (
            <InlineNotification
              kind="error"
              title={t('payroll.createError')}
              hideCloseButton
            />
          )}
          {rowError && (
            <InlineNotification
              kind="error"
              title={t('payroll.arithmeticError')}
              hideCloseButton
            />
          )}
          {employeeState === 'error' && (
            <InlineNotification
              kind="error"
              title={t('payroll.employeeLoadError')}
              hideCloseButton
            />
          )}
          {employeeState === 'loading' && (
            <InlineNotification
              kind="info"
              title={t('payroll.employeeLoading')}
              hideCloseButton
            />
          )}
          {employeeState === 'ready' && employees.length === 0 && (
            <InlineNotification
              kind="info"
              title={t('payroll.employeeEmpty')}
              hideCloseButton
            />
          )}
          <Select
            id="legalEntityId"
            labelText={t('payroll.legalEntity')}
            value={entityId}
            onChange={(e) => {
              setEntityId(e.target.value);
              setEmployees([]);
              setEmployeeState(e.target.value ? 'loading' : 'idle');
              setRows((current) =>
                current.map((row) => ({ ...row, employeeId: '' })),
              );
            }}
            required
          >
            <SelectItem value="" text={t('payroll.selectLegalEntity')} />
            {entities.map((e) => (
              <SelectItem key={e.id} value={e.id} text={e.name} />
            ))}
          </Select>
          <TextInput
            id="month"
            name="month"
            type="month"
            labelText={t('payroll.month')}
            required
          />
          {rows.map((row, i) => (
            <Stack gap={3} key={i}>
              <Select
                id={i === 0 ? 'employeeId' : `employee-${i}`}
                labelText={t('payroll.employee')}
                value={row.employeeId}
                onChange={(e) => update(i, 'employeeId', e.target.value)}
                required
              >
                <SelectItem value="" text={t('payroll.selectEmployee')} />
                {employees.map((e) => (
                  <SelectItem
                    key={e.id}
                    value={e.id}
                    text={`${e.employeeNumber}: ${e.firstName} ${e.lastName}`}
                  />
                ))}
              </Select>
              {(
                [
                  'grossPay',
                  'employeeSocial',
                  'employeeHealth',
                  'incomeTax',
                  'otherDeductions',
                  'netPay',
                  'employerSocial',
                  'employerHealth',
                  'totalEmployerCost',
                ] as const
              ).map((key) => (
                <TextInput
                  key={key}
                  id={i === 0 ? key : `${key}-${i}`}
                  labelText={t(`payroll.${key}`)}
                  value={row[key]}
                  onChange={(e) => update(i, key, e.target.value)}
                  required
                />
              ))}
              {rows.length > 1 && (
                <Button
                  type="button"
                  kind="danger--tertiary"
                  onClick={() => setRows(rows.filter((_, n) => n !== i))}
                >
                  {t('payroll.removeRow')}
                </Button>
              )}
            </Stack>
          ))}
          <Button
            type="button"
            onClick={() => setRows([...rows, blank()])}
            disabled={rows.length >= 1000}
          >
            {t('payroll.addRow')}
          </Button>
          <Button type="button" kind="secondary" onClick={reset}>
            {t('payroll.reset')}
          </Button>
          <Button type="submit">{t('payroll.create')}</Button>
        </Stack>
      </Form>
    </PageContainer>
  );
}
