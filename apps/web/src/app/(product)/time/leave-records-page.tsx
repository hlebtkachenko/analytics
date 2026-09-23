'use client';

import { DataGrid } from '@bap/design-system/blocks';
import {
  Button,
  Heading,
  InlineNotification,
  Modal,
  Select,
  SelectItem,
  Stack,
  TextInput,
} from '@bap/design-system/react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import {
  cancelLeaveRequest,
  createAbsence,
  createLeaveLedger,
  createLeaveRequest,
  decideLeaveRequest,
  getLeaveBalances,
  listAbsences,
  listLeaveRequests,
  listLeaveTypes,
  updateAbsence,
  type Absence,
  type LeaveRequest,
} from '../../../lib/hr-time/client';
import { useOrganizationAccess } from '../../../lib/organizations/use-organization-access';
import { useOrganizationSelection } from '../../../lib/organizations/use-organization-selection';

const integer = (value: string | null, max = 100) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= max ? parsed : 1;
};

const absenceKinds = [
  'sickness',
  'care',
  'parental',
  'unpaid',
  'other',
] as const;
type AbsenceKind = (typeof absenceKinds)[number];
const leaveStatuses = [
  'requested',
  'approved',
  'rejected',
  'cancelled',
  'taken',
] as const;

export function LeaveRecordsPage({
  employeeId,
  tabs,
  title,
}: Readonly<{ employeeId: string; tabs?: ReactNode; title: string }>) {
  const { t } = useTranslation();
  const organization = useOrganizationSelection();
  const { access, state: accessState } = useOrganizationAccess(
    organization.organizationId,
  );
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const page = integer(searchParams.get('page'));
  const pageSize = integer(searchParams.get('pageSize'));
  const from = searchParams.get('from') ?? '';
  const to = searchParams.get('to') ?? '';
  const status = searchParams.get('status') ?? '';
  const leaveTypeId = searchParams.get('leaveTypeId') ?? '';
  const kind = searchParams.get('kind') ?? '';
  const [requests, setRequests] = useState<LeaveRequest[]>();
  const [requestTotal, setRequestTotal] = useState(0);
  const [absences, setAbsences] = useState<Absence[]>();
  const [absenceTotal, setAbsenceTotal] = useState(0);
  const [balances, setBalances] =
    useState<{ leaveTypeId: string; unit: string; balance: string }[]>();
  const [leaveTypes, setLeaveTypes] = useState<{ id: string; name: string }[]>(
    [],
  );
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [commandError, setCommandError] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const [absenceOpen, setAbsenceOpen] = useState(false);
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [editingAbsence, setEditingAbsence] = useState<Absence>();
  const [reasonOpen, setReasonOpen] = useState<{
    id: string;
    action: 'approve' | 'reject' | 'cancel';
  }>();
  const [leaveForm, setLeaveForm] = useState({
    relationshipId: '',
    leaveTypeId: '',
    startsOn: '',
    endsOn: '',
    requestedAmount: '',
  });
  const [absenceForm, setAbsenceForm] = useState<{
    relationshipId: string;
    kind: AbsenceKind;
    startsOn: string;
    endsOn: string;
    payrollCode: string;
  }>({
    relationshipId: '',
    kind: 'other',
    startsOn: '',
    endsOn: '',
    payrollCode: '',
  });
  const [ledgerForm, setLedgerForm] = useState<{
    relationshipId: string;
    leaveTypeId: string;
    effectiveOn: string;
    amount: string;
    source: 'opening' | 'correction';
    reason: string;
  }>({
    relationshipId: '',
    leaveTypeId: '',
    effectiveOn: '',
    amount: '',
    source: 'correction',
    reason: '',
  });
  const [reason, setReason] = useState('');

  const replace = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams.toString());
    Object.entries(updates).forEach(([key, value]) => {
      if (value) next.set(key, value);
      else next.delete(key);
    });
    router.replace(`${pathname}?${next}` as never);
  };
  const load = useCallback(() => {
    if (!organization.organizationId || !access?.capabilities.readHr) return;
    setState('loading');
    void Promise.all([
      listLeaveRequests(organization.organizationId, employeeId, {
        page,
        pageSize,
        from: from || undefined,
        to: to || undefined,
        status: status || undefined,
        leaveTypeId: leaveTypeId || undefined,
      }),
      listAbsences(organization.organizationId, employeeId, {
        page,
        pageSize,
        from: from || undefined,
        to: to || undefined,
        kind: kind || undefined,
      }),
      getLeaveBalances(organization.organizationId, employeeId),
      listLeaveTypes(organization.organizationId, { page: 1, pageSize: 100 }),
    ])
      .then(([leave, absence, balance, types]) => {
        setRequests(leave.items);
        setRequestTotal(leave.total);
        setAbsences(absence.items);
        setAbsenceTotal(absence.total);
        setBalances(balance.items);
        setLeaveTypes(types.items.map(({ id, name }) => ({ id, name })));
        setState('ready');
      })
      .catch(() => setState('error'));
  }, [
    access?.capabilities.readHr,
    employeeId,
    from,
    kind,
    leaveTypeId,
    organization.organizationId,
    page,
    pageSize,
    status,
    to,
  ]);
  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  const command = (run: () => Promise<unknown>) => {
    setCommandError(false);
    void run()
      .then(load)
      .catch(() => setCommandError(true));
  };
  const gridState = (items: unknown[] | undefined) =>
    state === 'loading'
      ? 'loading'
      : state === 'error'
        ? 'error'
        : !items?.length
          ? 'empty'
          : 'ready';
  const openAbsence = (absence?: Absence) => {
    setEditingAbsence(absence);
    setAbsenceForm(
      absence
        ? {
            relationshipId: absence.relationshipId,
            kind: absence.kind,
            startsOn: absence.startsOn,
            endsOn: absence.endsOn ?? '',
            payrollCode: absence.payrollCode,
          }
        : {
            relationshipId: '',
            kind: 'other',
            startsOn: '',
            endsOn: '',
            payrollCode: '',
          },
    );
    setAbsenceOpen(true);
  };

  if (organization.state === 'error' || accessState === 'error')
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
    accessState === 'loading' ||
    access === undefined
  )
    return (
      <>
        <DataGrid columns={[]} rows={[]} state="loading" />
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

  return (
    <>
      <Stack gap={6}>
        {tabs}
        <Heading>{title}</Heading>
        <Stack gap={3} orientation="horizontal">
          <TextInput
            id="leave-from"
            labelText={t('time.dateFrom')}
            type="date"
            value={from}
            onChange={(event) =>
              replace({ from: event.target.value || null, page: '1' })
            }
          />
          <TextInput
            id="leave-to"
            labelText={t('time.dateTo')}
            type="date"
            value={to}
            onChange={(event) =>
              replace({ to: event.target.value || null, page: '1' })
            }
          />
          <Select
            id="leave-status"
            labelText={t('time.status')}
            value={status}
            onChange={(event) =>
              replace({ status: event.target.value || null, page: '1' })
            }
          >
            <SelectItem value="" text={t('time.status')} />
            {leaveStatuses.map((item) => (
              <SelectItem key={item} value={item} text={t(`time.${item}`)} />
            ))}
          </Select>
          <Select
            id="leave-type-filter"
            labelText={t('time.leaveType')}
            value={leaveTypeId}
            onChange={(event) =>
              replace({ leaveTypeId: event.target.value || null, page: '1' })
            }
          >
            <SelectItem value="" text={t('time.leaveType')} />
            {leaveTypes.map((item) => (
              <SelectItem key={item.id} value={item.id} text={item.name} />
            ))}
          </Select>
          <Select
            id="absence-kind-filter"
            labelText={t('time.absenceKind')}
            value={kind}
            onChange={(event) =>
              replace({ kind: event.target.value || null, page: '1' })
            }
          >
            <SelectItem value="" text={t('time.absenceKind')} />
            {absenceKinds.map((item) => (
              <SelectItem key={item} value={item} text={t(`time.${item}`)} />
            ))}
          </Select>
        </Stack>
        <Heading>{t('time.leave')}</Heading>
        {access.capabilities.manageHr ? (
          <Button onClick={() => setRequestOpen(true)}>
            {t('time.create')}
          </Button>
        ) : null}
        <DataGrid
          state={gridState(requests)}
          emptyLabel={t('time.leaveEmpty')}
          errorLabel={t('time.leaveError')}
          pagination
          paginationMode="server"
          page={page}
          pageSize={pageSize}
          totalItems={requestTotal}
          onPageChange={(nextPage, nextPageSize) =>
            replace({ page: String(nextPage), pageSize: String(nextPageSize) })
          }
          columns={[
            { key: 'startsOn', header: t('time.dateFrom') },
            { key: 'endsOn', header: t('time.dateTo') },
            { key: 'requestedAmount', header: t('time.leaveAmount') },
            { key: 'status', header: t('time.status') },
          ]}
          rows={requests ?? []}
          rowActions={(row) => {
            if (!access.capabilities.manageHr) return [];
            if (row.status === 'requested')
              return [
                {
                  id: 'approve',
                  label: t('time.approve'),
                  onClick: () =>
                    setReasonOpen({ id: row.id, action: 'approve' }),
                },
                {
                  id: 'reject',
                  label: t('time.reject'),
                  onClick: () =>
                    setReasonOpen({ id: row.id, action: 'reject' }),
                },
              ];
            if (row.status === 'approved')
              return [
                {
                  id: 'cancel',
                  label: t('time.cancel'),
                  onClick: () =>
                    setReasonOpen({ id: row.id, action: 'cancel' }),
                },
              ];
            return [];
          }}
        />
        <Heading>{t('time.leaveBalance')}</Heading>
        {access.capabilities.manageHr ? (
          <Button onClick={() => setLedgerOpen(true)}>
            {t('time.ledger')}
          </Button>
        ) : null}
        <DataGrid
          state={gridState(balances)}
          emptyLabel={t('time.leaveEmpty')}
          errorLabel={t('time.leaveError')}
          columns={[
            { key: 'leaveTypeId', header: t('time.leaveType') },
            { key: 'balance', header: t('time.balance') },
            { key: 'unit', header: t('time.leaveAmount') },
          ]}
          rows={(balances ?? []).map((balance) => ({
            ...balance,
            id: balance.leaveTypeId,
          }))}
        />
        <Heading>{t('time.absence')}</Heading>
        {access.capabilities.manageHr ? (
          <Button onClick={() => openAbsence()}>{t('time.create')}</Button>
        ) : null}
        <DataGrid
          state={gridState(absences)}
          emptyLabel={t('time.absenceEmpty')}
          errorLabel={t('time.absenceError')}
          pagination
          paginationMode="server"
          page={page}
          pageSize={pageSize}
          totalItems={absenceTotal}
          onPageChange={(nextPage, nextPageSize) =>
            replace({ page: String(nextPage), pageSize: String(nextPageSize) })
          }
          columns={[
            { key: 'kind', header: t('time.absenceKind') },
            { key: 'startsOn', header: t('time.dateFrom') },
            { key: 'endsOn', header: t('time.dateTo') },
          ]}
          rows={absences ?? []}
          rowActions={(row) =>
            access.capabilities.manageHr
              ? [
                  {
                    id: 'edit',
                    label: t('time.edit'),
                    onClick: () => openAbsence(row as Absence),
                  },
                ]
              : []
          }
        />
        <Modal
          open={requestOpen}
          modalHeading={t('time.leave')}
          primaryButtonText={t('time.save')}
          secondaryButtonText={t('employees.cancel')}
          onRequestClose={() => setRequestOpen(false)}
          onRequestSubmit={() =>
            command(async () => {
              await createLeaveRequest(
                organization.organizationId!,
                employeeId,
                leaveForm,
              );
              setRequestOpen(false);
            })
          }
        >
          {commandError ? (
            <InlineNotification
              kind="error"
              title={t('time.error')}
              hideCloseButton
            />
          ) : null}
          <Stack gap={4}>
            <TextInput
              id="leave-relationship"
              labelText={t('time.relationshipId')}
              value={leaveForm.relationshipId}
              onChange={(event) =>
                setLeaveForm({
                  ...leaveForm,
                  relationshipId: event.target.value,
                })
              }
            />
            <Select
              id="leave-type"
              labelText={t('time.leaveType')}
              value={leaveForm.leaveTypeId}
              onChange={(event) =>
                setLeaveForm({ ...leaveForm, leaveTypeId: event.target.value })
              }
            >
              <SelectItem value="" text={t('time.leaveType')} />
              {leaveTypes.map((item) => (
                <SelectItem key={item.id} value={item.id} text={item.name} />
              ))}
            </Select>
            <TextInput
              id="leave-start"
              labelText={t('time.dateFrom')}
              type="date"
              value={leaveForm.startsOn}
              onChange={(event) =>
                setLeaveForm({ ...leaveForm, startsOn: event.target.value })
              }
            />
            <TextInput
              id="leave-end"
              labelText={t('time.dateTo')}
              type="date"
              value={leaveForm.endsOn}
              onChange={(event) =>
                setLeaveForm({ ...leaveForm, endsOn: event.target.value })
              }
            />
            <TextInput
              id="leave-amount"
              labelText={t('time.leaveAmount')}
              value={leaveForm.requestedAmount}
              onChange={(event) =>
                setLeaveForm({
                  ...leaveForm,
                  requestedAmount: event.target.value,
                })
              }
            />
          </Stack>
        </Modal>
        <Modal
          open={absenceOpen}
          modalHeading={t('time.absence')}
          primaryButtonText={t('time.save')}
          secondaryButtonText={t('employees.cancel')}
          onRequestClose={() => setAbsenceOpen(false)}
          onRequestSubmit={() =>
            command(async () => {
              const body = {
                ...absenceForm,
                endsOn: absenceForm.endsOn || null,
              };
              if (editingAbsence)
                await updateAbsence(
                  organization.organizationId!,
                  employeeId,
                  editingAbsence.id,
                  body,
                );
              else
                await createAbsence(
                  organization.organizationId!,
                  employeeId,
                  body,
                );
              setAbsenceOpen(false);
              setEditingAbsence(undefined);
            })
          }
        >
          {commandError ? (
            <InlineNotification
              kind="error"
              title={t('time.error')}
              hideCloseButton
            />
          ) : null}
          <Stack gap={4}>
            <TextInput
              id="absence-relationship"
              labelText={t('time.relationshipId')}
              value={absenceForm.relationshipId}
              onChange={(event) =>
                setAbsenceForm({
                  ...absenceForm,
                  relationshipId: event.target.value,
                })
              }
            />
            <Select
              id="absence-kind"
              labelText={t('time.absenceKind')}
              value={absenceForm.kind}
              onChange={(event) =>
                setAbsenceForm({
                  ...absenceForm,
                  kind: event.target.value as AbsenceKind,
                })
              }
            >
              {absenceKinds.map((item) => (
                <SelectItem key={item} value={item} text={t(`time.${item}`)} />
              ))}
            </Select>
            <TextInput
              id="absence-start"
              labelText={t('time.dateFrom')}
              type="date"
              value={absenceForm.startsOn}
              onChange={(event) =>
                setAbsenceForm({ ...absenceForm, startsOn: event.target.value })
              }
            />
            <TextInput
              id="absence-end"
              labelText={t('time.dateTo')}
              type="date"
              value={absenceForm.endsOn}
              onChange={(event) =>
                setAbsenceForm({ ...absenceForm, endsOn: event.target.value })
              }
            />
            <TextInput
              id="absence-payroll-code"
              labelText={t('employees.code')}
              value={absenceForm.payrollCode}
              onChange={(event) =>
                setAbsenceForm({
                  ...absenceForm,
                  payrollCode: event.target.value,
                })
              }
            />
          </Stack>
        </Modal>
        <Modal
          open={ledgerOpen}
          modalHeading={t('time.ledger')}
          primaryButtonText={t('time.save')}
          secondaryButtonText={t('employees.cancel')}
          onRequestClose={() => setLedgerOpen(false)}
          onRequestSubmit={() =>
            command(async () => {
              await createLeaveLedger(
                organization.organizationId!,
                employeeId,
                ledgerForm,
              );
              setLedgerOpen(false);
            })
          }
        >
          {commandError ? (
            <InlineNotification
              kind="error"
              title={t('time.error')}
              hideCloseButton
            />
          ) : null}
          <Stack gap={4}>
            <TextInput
              id="ledger-relationship"
              labelText={t('time.relationshipId')}
              value={ledgerForm.relationshipId}
              onChange={(event) =>
                setLedgerForm({
                  ...ledgerForm,
                  relationshipId: event.target.value,
                })
              }
            />
            <Select
              id="ledger-type"
              labelText={t('time.leaveType')}
              value={ledgerForm.leaveTypeId}
              onChange={(event) =>
                setLedgerForm({
                  ...ledgerForm,
                  leaveTypeId: event.target.value,
                })
              }
            >
              <SelectItem value="" text={t('time.leaveType')} />
              {leaveTypes.map((item) => (
                <SelectItem key={item.id} value={item.id} text={item.name} />
              ))}
            </Select>
            <Select
              id="ledger-source"
              labelText={t('time.ledger')}
              value={ledgerForm.source}
              onChange={(event) =>
                setLedgerForm({
                  ...ledgerForm,
                  source: event.target.value as 'opening' | 'correction',
                })
              }
            >
              <SelectItem value="opening" text={t('time.opening')} />
              <SelectItem value="correction" text={t('time.correction')} />
            </Select>
            <TextInput
              id="ledger-amount"
              labelText={t('time.leaveAmount')}
              value={ledgerForm.amount}
              onChange={(event) =>
                setLedgerForm({ ...ledgerForm, amount: event.target.value })
              }
            />
            <TextInput
              id="ledger-date"
              labelText={t('time.dateFrom')}
              type="date"
              value={ledgerForm.effectiveOn}
              onChange={(event) =>
                setLedgerForm({
                  ...ledgerForm,
                  effectiveOn: event.target.value,
                })
              }
            />
            <TextInput
              id="ledger-reason"
              labelText={t('time.rejectionReason')}
              value={ledgerForm.reason}
              onChange={(event) =>
                setLedgerForm({ ...ledgerForm, reason: event.target.value })
              }
            />
          </Stack>
        </Modal>
        <Modal
          open={reasonOpen !== undefined}
          modalHeading={t('time.rejectionReason')}
          primaryButtonText={t('time.save')}
          secondaryButtonText={t('employees.cancel')}
          onRequestClose={() => {
            setReasonOpen(undefined);
            setReason('');
          }}
          onRequestSubmit={() => {
            if (
              !reasonOpen ||
              (reasonOpen.action === 'reject' && !reason.trim())
            )
              return;
            command(async () => {
              const optionalReason = reason.trim() || undefined;
              if (reasonOpen.action === 'cancel')
                await cancelLeaveRequest(
                  organization.organizationId!,
                  employeeId,
                  reasonOpen.id,
                  optionalReason ? { reason: optionalReason } : {},
                );
              else
                await decideLeaveRequest(
                  organization.organizationId!,
                  employeeId,
                  reasonOpen.id,
                  {
                    decision:
                      reasonOpen.action === 'approve' ? 'approved' : 'rejected',
                    ...(optionalReason ? { reason: optionalReason } : {}),
                  },
                );
              setReasonOpen(undefined);
              setReason('');
            });
          }}
        >
          {commandError ? (
            <InlineNotification
              kind="error"
              title={t('time.error')}
              hideCloseButton
            />
          ) : null}
          <TextInput
            id="leave-reason"
            labelText={t('time.rejectionReason')}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Modal>
      </Stack>
    </>
  );
}
