'use client';

import {
  Button,
  Form,
  InlineNotification,
  Modal,
  Stack,
  TextInput,
  Tile,
} from '@bap/design-system/react';
import { DataGrid } from '@bap/design-system/blocks';
import {
  useParams,
  usePathname,
  useRouter,
  useSearchParams,
} from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { z } from 'zod';

import PageContainer from '../../../../components/page-container';
import { useToast } from '../../../../components/shell/toast';
import { getJson } from '../../../../lib/datasets/client';
import {
  employeePath,
  employeeStatusHistoryPath,
  employeeStatusTransitionsPath,
  sendHrJson,
} from '../../../../lib/hr/client';
import {
  employeeDetailSchema,
  employeeSchema,
  employeeStatusHistorySchema,
  employeeStatusTransitionSchema,
  updateEmployeeSchema,
} from '../../../../lib/hr/contract';
import { useOrganizationAccess } from '../../../../lib/organizations/use-organization-access';
import { useOrganizationSelection } from '../../../../lib/organizations/use-organization-selection';
import { EmployeeTabs } from './employee-tabs';

type Transition = {
  action: 'activate' | 'cancel' | 'deactivate' | 'reactivate' | 'archive';
  toStatus: 'active' | 'cancelled' | 'inactive' | 'archived';
};

const transitions: Record<string, readonly Transition[]> = {
  preboarding: [
    { action: 'activate', toStatus: 'active' },
    { action: 'cancel', toStatus: 'cancelled' },
  ],
  active: [{ action: 'deactivate', toStatus: 'inactive' }],
  inactive: [
    { action: 'reactivate', toStatus: 'active' },
    { action: 'archive', toStatus: 'archived' },
  ],
  archived: [],
  cancelled: [],
};

export default function EmployeeDetailPage() {
  const { t } = useTranslation();
  const { notify } = useToast();
  const { employeeId } = useParams<{ employeeId: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const org = useOrganizationSelection();
  const { access, state: accessState } = useOrganizationAccess(
    org.organizationId,
  );
  const rawPage = Number(searchParams.get('page'));
  const rawPageSize = Number(searchParams.get('pageSize'));
  const page = Number.isInteger(rawPage) && rawPage >= 1 ? rawPage : 1;
  const pageSize =
    Number.isInteger(rawPageSize) && rawPageSize >= 1 && rawPageSize <= 100
      ? rawPageSize
      : 25;
  const [employee, setEmployee] =
    useState<typeof employeeDetailSchema._output>();
  const [history, setHistory] =
    useState<typeof employeeStatusHistorySchema._output>();
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [mutationError, setMutationError] = useState(false);
  const [transition, setTransition] = useState<Transition | null>(null);
  const [transitionError, setTransitionError] = useState<
    'validation' | 'conflict' | 'general' | null
  >(null);
  const load = useCallback(() => {
    if (!org.organizationId || !access?.capabilities.readHr) return;
    const query = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
    });
    void Promise.all([
      getJson(
        employeePath(org.organizationId, employeeId),
        new AbortController().signal,
      ).then((value) => employeeDetailSchema.parse(value)),
      getJson(
        employeeStatusHistoryPath(org.organizationId, employeeId, query),
        new AbortController().signal,
      ).then((value) => employeeStatusHistorySchema.parse(value)),
    ])
      .then(([nextEmployee, nextHistory]) => {
        setEmployee(nextEmployee);
        setHistory(nextHistory);
        setState('ready');
      })
      .catch(() => setState('error'));
  }, [
    access?.capabilities.readHr,
    employeeId,
    org.organizationId,
    page,
    pageSize,
  ]);
  useEffect(() => {
    load();
  }, [load]);
  const mutate = async <T,>(body: unknown, schema: z.ZodType<T>) => {
    try {
      await sendHrJson(
        employeePath(org.organizationId, employeeId),
        'PATCH',
        body,
        schema,
      );
      setMutationError(false);
      load();
    } catch {
      setMutationError(true);
    }
  };
  const submitEmployee = (form: HTMLFormElement) => {
    const data = new FormData(form);
    try {
      void mutate(
        updateEmployeeSchema.parse({
          firstName: data.get('firstName'),
          lastName: data.get('lastName'),
          workEmail: data.get('workEmail') || null,
          workPhone: data.get('workPhone') || null,
        }),
        employeeSchema,
      );
    } catch {
      setMutationError(true);
    }
  };
  const submitTransition = (form: HTMLFormElement) => {
    if (!transition) return;
    const data = new FormData(form);
    const effectiveAt = String(data.get('effectiveAt') ?? '');
    const reason = String(data.get('reason') ?? '').trim();
    try {
      const body = employeeStatusTransitionSchema.parse({
        toStatus: transition.toStatus,
        effectiveAt: new Date(effectiveAt).toISOString(),
        ...(transition.action === 'reactivate' ? { reason } : {}),
      });
      void sendHrJson(
        employeeStatusTransitionsPath(org.organizationId, employeeId),
        'POST',
        body,
        employeeStatusHistorySchema.shape.items.element,
      )
        .then(() => {
          setTransition(null);
          setTransitionError(null);
          notify({ kind: 'success', title: t('employees.transitionSaved') });
          load();
        })
        .catch((error: unknown) =>
          setTransitionError(
            error instanceof Error && 'status' in error && error.status === 400
              ? 'validation'
              : error instanceof Error &&
                  'status' in error &&
                  error.status === 409
                ? 'conflict'
                : 'general',
          ),
        );
    } catch {
      setTransitionError('validation');
    }
  };
  if (org.state === 'error' || accessState === 'error')
    return (
      <PageContainer>
        <InlineNotification
          kind="error"
          title={t('employees.accessError')}
          hideCloseButton
        />
      </PageContainer>
    );
  if (access !== undefined && !access.capabilities.readHr)
    return (
      <PageContainer>
        <InlineNotification
          kind="error"
          title={t('employees.denied')}
          hideCloseButton
        />
      </PageContainer>
    );
  if (state === 'error')
    return (
      <PageContainer>
        <InlineNotification
          kind="error"
          title={t('employees.error')}
          hideCloseButton
        />
      </PageContainer>
    );
  if (
    org.state === 'loading' ||
    accessState === 'loading' ||
    access === undefined ||
    state === 'loading' ||
    !employee ||
    !history
  )
    return (
      <PageContainer>
        <p>{t('employees.loading')}</p>
      </PageContainer>
    );
  const manage = access.capabilities.manageHr;
  const availableTransitions = transitions[employee.status] ?? [];
  return (
    <PageContainer>
      <Stack gap={6}>
        <EmployeeTabs />
        {mutationError && (
          <InlineNotification
            kind="error"
            title={t('employees.mutationError')}
            hideCloseButton
          />
        )}
        <Tile>
          <h2>{t('employees.overview')}</h2>
          <Form
            onSubmit={(event) => {
              event.preventDefault();
              submitEmployee(event.currentTarget);
            }}
          >
            <Stack gap={3}>
              <TextInput
                id="firstName"
                name="firstName"
                labelText={t('employees.firstName')}
                defaultValue={employee.firstName}
                readOnly={!manage}
              />
              <TextInput
                id="lastName"
                name="lastName"
                labelText={t('employees.lastName')}
                defaultValue={employee.lastName}
                readOnly={!manage}
              />
              <TextInput
                id="workEmail"
                name="workEmail"
                labelText={t('employees.workEmail')}
                defaultValue={employee.workEmail ?? ''}
                readOnly={!manage}
              />
              <TextInput
                id="workPhone"
                name="workPhone"
                labelText={t('employees.workPhone')}
                defaultValue={employee.workPhone ?? ''}
                readOnly={!manage}
              />
              <TextInput
                id="status"
                labelText={t('employees.status')}
                value={t(`employees.${employee.status}`)}
                readOnly
              />
              {manage && <Button type="submit">{t('employees.save')}</Button>}
            </Stack>
          </Form>
          {manage && availableTransitions.length > 0 && (
            <Stack gap={3} orientation="horizontal">
              {availableTransitions.map((item) => (
                <Button
                  key={item.action}
                  kind={
                    item.action === 'cancel' || item.action === 'archive'
                      ? 'danger'
                      : 'secondary'
                  }
                  onClick={() => {
                    setTransitionError(null);
                    setTransition(item);
                  }}
                >
                  {t(`employees.${item.action}`)}
                </Button>
              ))}
            </Stack>
          )}
        </Tile>
        <Tile>
          <h2>{t('employees.statusHistory')}</h2>
          <DataGrid
            columns={[
              { key: 'effectiveAt', header: t('employees.effectiveAt') },
              { key: 'fromStatus', header: t('employees.fromStatus') },
              { key: 'toStatus', header: t('employees.toStatus') },
              { key: 'reason', header: t('employees.reason') },
            ]}
            rows={history.items.map((item) => ({
              id: item.id,
              effectiveAt: item.effectiveAt,
              fromStatus: item.fromStatus
                ? t(`employees.${item.fromStatus}`)
                : t('employees.initialStatus'),
              toStatus: t(`employees.${item.toStatus}`),
              reason: item.reason ?? '',
            }))}
            state={history.items.length === 0 ? 'empty' : 'ready'}
            emptyLabel={t('employees.historyEmpty')}
            pagination
            paginationMode="server"
            page={history.page}
            pageSize={history.pageSize}
            totalItems={history.total}
            onPageChange={(next, size) => {
              const nextParams = new URLSearchParams(searchParams.toString());
              nextParams.set('page', String(next));
              nextParams.set('pageSize', String(size));
              router.replace(`${pathname}?${nextParams}` as never);
            }}
          />
        </Tile>
        {transition && (
          <Modal
            key={transition.action}
            open
            modalHeading={t(`employees.${transition.action}`)}
            primaryButtonText={t('employees.confirmTransition')}
            secondaryButtonText={t('common.cancel')}
            onRequestClose={() => setTransition(null)}
            onRequestSubmit={() =>
              (
                document.getElementById(
                  'status-transition-form',
                ) as HTMLFormElement | null
              )?.requestSubmit()
            }
          >
            <Form
              id="status-transition-form"
              onSubmit={(event) => {
                event.preventDefault();
                submitTransition(event.currentTarget);
              }}
            >
              <Stack gap={3}>
                {transitionError && (
                  <InlineNotification
                    kind="error"
                    title={t(
                      `employees.transition${transitionError[0]!.toUpperCase()}${transitionError.slice(1)}`,
                    )}
                    hideCloseButton
                  />
                )}
                <TextInput
                  id="effectiveAt"
                  name="effectiveAt"
                  type="datetime-local"
                  labelText={t('employees.effectiveAt')}
                  required
                />
                {transition.action === 'reactivate' && (
                  <TextInput
                    id="reason"
                    name="reason"
                    labelText={t('employees.reason')}
                    required
                  />
                )}
              </Stack>
            </Form>
          </Modal>
        )}
      </Stack>
    </PageContainer>
  );
}
