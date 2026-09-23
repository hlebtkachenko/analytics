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
  approveTimesheet,
  createSchedule,
  createTimesheet,
  correctTimesheet,
  listSchedules,
  listAbsences,
  listTimesheets,
  publishSchedule,
  rejectTimesheet,
  submitTimesheet,
  updateTimesheet,
  type Schedule,
  type Absence,
  type Timesheet,
} from '../../../lib/hr-time/client';
import { useOrganizationAccess } from '../../../lib/organizations/use-organization-access';
import { useOrganizationSelection } from '../../../lib/organizations/use-organization-selection';

const integer = (value: string | null, max = 100) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= max ? parsed : 1;
};

const localTime = (value: string) =>
  new Intl.DateTimeFormat('cs-CZ', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Europe/Prague',
  }).format(new Date(value));

export function TimeRecordsPage({
  employeeId,
  mode = 'overview',
  tabs,
  title,
}: Readonly<{
  employeeId: string;
  mode?: 'overview' | 'timesheets' | 'approvals' | 'calendar';
  tabs?: ReactNode;
  title: string;
}>) {
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
  const status =
    mode === 'approvals'
      ? 'submitted'
      : mode === 'calendar'
        ? 'published'
        : (searchParams.get('status') ?? '');
  const [schedules, setSchedules] = useState<Schedule[]>();
  const [timesheets, setTimesheets] = useState<Timesheet[]>();
  const [absences, setAbsences] = useState<Absence[]>();
  const [scheduleTotal, setScheduleTotal] = useState(0);
  const [timesheetTotal, setTimesheetTotal] = useState(0);
  const [absenceTotal, setAbsenceTotal] = useState(0);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [timesheetOpen, setTimesheetOpen] = useState(false);
  const [editingTimesheetId, setEditingTimesheetId] = useState<string>();
  const [reasonOpen, setReasonOpen] = useState<{
    id: string;
    action: 'correct' | 'reject';
  }>();
  const [form, setForm] = useState({
    relationshipId: '',
    periodStart: '',
    periodEnd: '',
    startsAt: '',
    endsAt: '',
    workDate: '',
  });
  const [reason, setReason] = useState('');
  const [commandError, setCommandError] = useState(false);
  const [modalError, setModalError] = useState(false);

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
    const query = {
      page,
      pageSize,
      from: from || undefined,
      to: to || undefined,
      status: status || undefined,
    };
    const scheduleQuery = {
      ...query,
      status: ['draft', 'published', 'superseded'].includes(status)
        ? status || undefined
        : undefined,
    };
    const timesheetQuery = {
      ...query,
      status: ['draft', 'submitted', 'approved', 'corrected'].includes(status)
        ? status || undefined
        : undefined,
    };
    setState('loading');
    const scheduleRequest =
      mode === 'timesheets' || mode === 'approvals'
        ? Promise.resolve(undefined)
        : listSchedules(organization.organizationId, employeeId, scheduleQuery);
    const timesheetRequest =
      mode === 'calendar'
        ? Promise.resolve(undefined)
        : listTimesheets(
            organization.organizationId,
            employeeId,
            timesheetQuery,
          );
    const absenceRequest =
      mode === 'calendar'
        ? listAbsences(organization.organizationId, employeeId, {
            page,
            pageSize,
            from: from || undefined,
            to: to || undefined,
          })
        : Promise.resolve(undefined);
    void Promise.all([scheduleRequest, timesheetRequest, absenceRequest])
      .then(([scheduleResult, timesheetResult, absenceResult]) => {
        setSchedules(scheduleResult?.items);
        setTimesheets(timesheetResult?.items);
        setScheduleTotal(scheduleResult?.total ?? 0);
        setTimesheetTotal(timesheetResult?.total ?? 0);
        setAbsences(absenceResult?.items);
        setAbsenceTotal(absenceResult?.total ?? 0);
        setState('ready');
      })
      .catch(() => setState('error'));
  }, [
    access?.capabilities.readHr,
    employeeId,
    organization.organizationId,
    page,
    pageSize,
    from,
    status,
    to,
    mode,
  ]);
  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  const command = (run: () => Promise<unknown>, inModal = false) => {
    setCommandError(false);
    if (inModal) setModalError(false);
    void run()
      .then(load)
      .catch(() => {
        setCommandError(true);
        if (inModal) setModalError(true);
      });
  };
  const validPeriod =
    Boolean(form.relationshipId && form.periodStart && form.periodEnd) &&
    form.periodStart <= form.periodEnd;
  const validInterval =
    Boolean(form.startsAt && form.endsAt) && form.startsAt < form.endsAt;
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
  const gridState = (items: unknown[] | undefined) =>
    state === 'loading'
      ? 'loading'
      : state === 'error'
        ? 'error'
        : !items?.length
          ? 'empty'
          : 'ready';
  return (
    <>
      <Stack gap={6}>
        {tabs}
        <Heading>{title}</Heading>
        {commandError ? (
          <InlineNotification
            kind="error"
            title={t('time.error')}
            hideCloseButton
          />
        ) : null}
        <InlineNotification
          kind="info"
          title={t('time.utcNote')}
          hideCloseButton
        />
        <Stack gap={3} orientation="horizontal">
          <TextInput
            id="from"
            labelText={t('time.dateFrom')}
            type="date"
            value={from}
            onChange={(event) =>
              replace({ from: event.target.value || null, page: '1' })
            }
          />
          <TextInput
            id="to"
            labelText={t('time.dateTo')}
            type="date"
            value={to}
            onChange={(event) =>
              replace({ to: event.target.value || null, page: '1' })
            }
          />
          {mode !== 'approvals' && mode !== 'calendar' ? (
            <Select
              id="status"
              labelText={t('time.status')}
              value={status}
              onChange={(event) =>
                replace({ status: event.target.value || null, page: '1' })
              }
            >
              <SelectItem value="" text={t('time.status')} />
              <SelectItem value="draft" text={t('time.statusDraft')} />
              <SelectItem value="submitted" text={t('time.statusSubmitted')} />
              <SelectItem value="approved" text={t('time.statusApproved')} />
              <SelectItem value="corrected" text={t('time.statusCorrected')} />
              <SelectItem value="published" text={t('time.statusPublished')} />
              <SelectItem
                value="superseded"
                text={t('time.statusSuperseded')}
              />
            </Select>
          ) : null}
        </Stack>
        {mode !== 'timesheets' && mode !== 'approvals' ? (
          <Heading>{t('time.schedules')}</Heading>
        ) : null}
        {mode !== 'timesheets' &&
        mode !== 'approvals' &&
        access.capabilities.manageHr ? (
          <Button onClick={() => setScheduleOpen(true)}>
            {t('time.createSchedule')}
          </Button>
        ) : null}
        {mode !== 'timesheets' && mode !== 'approvals' ? (
          <DataGrid
            state={gridState(schedules)}
            emptyLabel={t('time.scheduleEmpty')}
            errorLabel={t('time.scheduleError')}
            columns={[
              { key: 'periodStart', header: t('time.dateFrom') },
              { key: 'periodEnd', header: t('time.dateTo') },
              { key: 'status', header: t('time.status') },
              { key: 'shifts', header: t('time.schedule') },
            ]}
            rows={(schedules ?? []).map((item) => ({
              ...item,
              shifts: item.shifts
                .map(
                  (shift) =>
                    `${localTime(shift.startsAt)} - ${localTime(shift.endsAt)}`,
                )
                .join(', '),
            }))}
            pagination
            paginationMode="server"
            page={page}
            pageSize={pageSize}
            totalItems={scheduleTotal}
            onPageChange={(next, size) =>
              replace({ page: String(next), pageSize: String(size) })
            }
            rowActions={(row) =>
              access.capabilities.manageHr && row.status === 'draft'
                ? [
                    {
                      id: 'publish',
                      label: t('employees.approve'),
                      onClick: () =>
                        command(() =>
                          publishSchedule(
                            organization.organizationId!,
                            employeeId,
                            row.id,
                          ),
                        ),
                    },
                  ]
                : []
            }
          />
        ) : null}
        {mode !== 'calendar' ? <Heading>{t('time.timesheets')}</Heading> : null}
        {mode !== 'calendar' && access.capabilities.manageHr ? (
          <Button onClick={() => setTimesheetOpen(true)}>
            {t('time.createTimesheet')}
          </Button>
        ) : null}
        {mode !== 'calendar' ? (
          <DataGrid
            state={gridState(timesheets)}
            emptyLabel={t('time.timesheetEmpty')}
            errorLabel={t('time.timesheetError')}
            columns={[
              { key: 'periodStart', header: t('time.dateFrom') },
              { key: 'periodEnd', header: t('time.dateTo') },
              { key: 'totalWorkedMinutes', header: t('time.totalWorked') },
              { key: 'status', header: t('time.status') },
            ]}
            rows={(timesheets ?? []).map((timesheet) => ({
              ...timesheet,
              entries: undefined,
            }))}
            pagination
            paginationMode="server"
            page={page}
            pageSize={pageSize}
            totalItems={timesheetTotal}
            onPageChange={(next, size) =>
              replace({ page: String(next), pageSize: String(size) })
            }
            rowActions={(row) => {
              if (!access.capabilities.manageHr) return [];
              if (row.status === 'draft')
                return [
                  {
                    id: 'edit',
                    label: t('time.edit'),
                    onClick: () => {
                      const item = timesheets?.find(
                        (value) => value.id === row.id,
                      );
                      const entry = item?.entries[0];
                      if (!item || !entry) return;
                      setForm({
                        relationshipId: item.relationshipId,
                        periodStart: item.periodStart,
                        periodEnd: item.periodEnd,
                        workDate: entry.workDate,
                        startsAt: entry.startedAt.slice(0, 16),
                        endsAt: entry.endedAt.slice(0, 16),
                      });
                      setEditingTimesheetId(item.id);
                      setTimesheetOpen(true);
                    },
                  },
                  {
                    id: 'submit',
                    label: t('time.submit'),
                    onClick: () =>
                      command(() =>
                        submitTimesheet(
                          organization.organizationId!,
                          employeeId,
                          row.id,
                        ),
                      ),
                  },
                ];
              if (row.status === 'submitted')
                return [
                  {
                    id: 'approve',
                    label: t('time.approve'),
                    onClick: () =>
                      command(() =>
                        approveTimesheet(
                          organization.organizationId!,
                          employeeId,
                          row.id,
                        ),
                      ),
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
                    id: 'correct',
                    label: t('employees.correctTerm'),
                    onClick: () =>
                      setReasonOpen({ id: row.id, action: 'correct' }),
                  },
                ];
              return [];
            }}
          />
        ) : null}
        {mode === 'calendar' ? (
          <>
            <Heading>{t('time.absence')}</Heading>
            <DataGrid
              state={gridState(absences)}
              emptyLabel={t('time.absenceEmpty')}
              errorLabel={t('time.absenceError')}
              columns={[
                { key: 'kind', header: t('time.absenceKind') },
                { key: 'startsOn', header: t('time.dateFrom') },
                { key: 'endsOn', header: t('time.dateTo') },
              ]}
              rows={absences ?? []}
              pagination
              paginationMode="server"
              page={page}
              pageSize={pageSize}
              totalItems={absenceTotal}
              onPageChange={(next, size) =>
                replace({ page: String(next), pageSize: String(size) })
              }
            />
          </>
        ) : null}
        <Modal
          open={scheduleOpen}
          modalHeading={t('time.createSchedule')}
          primaryButtonText={t('time.save')}
          secondaryButtonText={t('employees.cancel')}
          onRequestClose={() => {
            setScheduleOpen(false);
            setModalError(false);
          }}
          onRequestSubmit={() => {
            if (!validPeriod || !validInterval) {
              setModalError(true);
              return;
            }
            command(async () => {
              await createSchedule(organization.organizationId!, employeeId, {
                relationshipId: form.relationshipId,
                periodStart: form.periodStart,
                periodEnd: form.periodEnd,
                shifts: [
                  {
                    startsAt: new Date(form.startsAt).toISOString(),
                    endsAt: new Date(form.endsAt).toISOString(),
                  },
                ],
              });
              setScheduleOpen(false);
            }, true);
          }}
        >
          <Stack gap={4}>
            {modalError ? (
              <InlineNotification
                kind="error"
                title={t('time.invalidForm')}
                hideCloseButton
              />
            ) : null}
            <TextInput
              id="scheduleRelationship"
              labelText={t('time.relationshipId')}
              value={form.relationshipId}
              onChange={(e) =>
                setForm({ ...form, relationshipId: e.target.value })
              }
            />
            <TextInput
              id="scheduleStart"
              labelText={t('time.startsAt')}
              type="datetime-local"
              value={form.startsAt}
              onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
            />
            <TextInput
              id="scheduleEnd"
              labelText={t('time.endsAt')}
              type="datetime-local"
              value={form.endsAt}
              onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
            />
            <TextInput
              id="schedulePeriodStart"
              labelText={t('time.dateFrom')}
              type="date"
              value={form.periodStart}
              onChange={(e) =>
                setForm({ ...form, periodStart: e.target.value })
              }
            />
            <TextInput
              id="schedulePeriodEnd"
              labelText={t('time.dateTo')}
              type="date"
              value={form.periodEnd}
              onChange={(e) => setForm({ ...form, periodEnd: e.target.value })}
            />
          </Stack>
        </Modal>
        <Modal
          open={timesheetOpen}
          modalHeading={t(
            editingTimesheetId ? 'time.edit' : 'time.createTimesheet',
          )}
          primaryButtonText={t('time.save')}
          secondaryButtonText={t('employees.cancel')}
          onRequestClose={() => {
            setTimesheetOpen(false);
            setEditingTimesheetId(undefined);
            setModalError(false);
          }}
          onRequestSubmit={() => {
            if (!validPeriod || !validInterval || !form.workDate) {
              setModalError(true);
              return;
            }
            command(async () => {
              const entries = [
                {
                  workDate: form.workDate,
                  startedAt: new Date(form.startsAt).toISOString(),
                  endedAt: new Date(form.endsAt).toISOString(),
                },
              ];
              if (editingTimesheetId)
                await updateTimesheet(
                  organization.organizationId!,
                  employeeId,
                  editingTimesheetId,
                  { entries },
                );
              else
                await createTimesheet(
                  organization.organizationId!,
                  employeeId,
                  {
                    relationshipId: form.relationshipId,
                    periodStart: form.periodStart,
                    periodEnd: form.periodEnd,
                    entries,
                  },
                );
              setTimesheetOpen(false);
              setEditingTimesheetId(undefined);
            }, true);
          }}
        >
          <Stack gap={4}>
            {modalError ? (
              <InlineNotification
                kind="error"
                title={t('time.invalidForm')}
                hideCloseButton
              />
            ) : null}
            <TextInput
              id="timesheetRelationship"
              labelText={t('time.relationshipId')}
              value={form.relationshipId}
              onChange={(e) =>
                setForm({ ...form, relationshipId: e.target.value })
              }
            />
            <TextInput
              id="timesheetWorkDate"
              labelText={t('time.workDate')}
              type="date"
              value={form.workDate}
              onChange={(e) => setForm({ ...form, workDate: e.target.value })}
            />
            <TextInput
              id="timesheetStart"
              labelText={t('time.startsAt')}
              type="datetime-local"
              value={form.startsAt}
              onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
            />
            <TextInput
              id="timesheetEnd"
              labelText={t('time.endsAt')}
              type="datetime-local"
              value={form.endsAt}
              onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
            />
            <TextInput
              id="timesheetPeriodStart"
              labelText={t('time.dateFrom')}
              type="date"
              value={form.periodStart}
              onChange={(e) =>
                setForm({ ...form, periodStart: e.target.value })
              }
            />
            <TextInput
              id="timesheetPeriodEnd"
              labelText={t('time.dateTo')}
              type="date"
              value={form.periodEnd}
              onChange={(e) => setForm({ ...form, periodEnd: e.target.value })}
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
            setModalError(false);
          }}
          onRequestSubmit={() => {
            if (!reasonOpen || !reason.trim()) {
              setModalError(true);
              return;
            }
            command(async () => {
              if (reasonOpen.action === 'reject')
                await rejectTimesheet(
                  organization.organizationId!,
                  employeeId,
                  reasonOpen.id,
                  { reason },
                );
              else
                await correctTimesheet(
                  organization.organizationId!,
                  employeeId,
                  reasonOpen.id,
                  { reason },
                );
              setReasonOpen(undefined);
              setReason('');
            }, true);
          }}
        >
          <Stack gap={4}>
            {modalError ? (
              <InlineNotification
                kind="error"
                title={t('time.invalidForm')}
                hideCloseButton
              />
            ) : null}
            <TextInput
              id="timesheetReason"
              labelText={t('time.rejectionReason')}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Stack>
        </Modal>
      </Stack>
    </>
  );
}
