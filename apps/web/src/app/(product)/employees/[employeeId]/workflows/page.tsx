'use client';
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
import { DataGrid } from '@bap/design-system/blocks';
import {
  useParams,
  usePathname,
  useRouter,
  useSearchParams,
} from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import PageContainer from '../../../../../components/page-container';
import { useToast } from '../../../../../components/shell/toast';
import { getJson } from '../../../../../lib/datasets/client';
import {
  checklistTaskPath,
  checklistTemplatesPath,
  employeeChecklistsPath,
  employeePath,
  HrRequestError,
  sendHrJson,
} from '../../../../../lib/hr/client';
import {
  checklistKindSchema,
  checklistSchema,
  checklistStatusSchema,
  checklistTaskSchema,
  checklistTemplateListSchema,
  createEmployeeChecklistSchema,
  employeeChecklistListSchema,
  employeeDetailSchema,
  identifierSchema,
  updateChecklistTaskSchema,
} from '../../../../../lib/hr/contract';
import { useOrganizationAccess } from '../../../../../lib/organizations/use-organization-access';
import { useOrganizationSelection } from '../../../../../lib/organizations/use-organization-selection';
import { EmployeeTabs } from '../employee-tabs';
const number = (v: string | null, d: number, max = 100) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= max ? n : d;
};
export default function WorkflowsPage() {
  const { t } = useTranslation();
  const { employeeId } = useParams<{ employeeId: string }>();
  const org = useOrganizationSelection();
  const { access, state: accessState } = useOrganizationAccess(
    org.organizationId,
  );
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { notify } = useToast();
  const kind = checklistKindSchema.safeParse(params.get('kind'));
  const status = checklistStatusSchema.safeParse(params.get('status'));
  const selectedId = identifierSchema.safeParse(params.get('checklistId'));
  const page = number(params.get('page'), 1);
  const pageSize = number(params.get('pageSize'), 25);
  const [data, setData] =
    useState<typeof employeeChecklistListSchema._output>();
  const [employee, setEmployee] =
    useState<typeof employeeDetailSchema._output>();
  const [templates, setTemplates] =
    useState<typeof checklistTemplateListSchema._output>();
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [start, setStart] = useState(false);
  const [task, setTask] = useState<typeof checklistTaskSchema._output | null>(
    null,
  );
  const [templateId, setTemplateId] = useState('');
  const [startedOn, setStartedOn] = useState('');
  const [ownerUserId, setOwnerUserId] = useState('');
  const [relationshipId, setRelationshipId] = useState('');
  const [documentId, setDocumentId] = useState('');
  const [skipReason, setSkipReason] = useState('');
  const [command, setCommand] = useState<
    'in_progress' | 'completed' | 'skipped' | null
  >(null);
  const [error, setError] = useState<'conflict' | 'general' | null>(null);
  const replace = (p: Record<string, string | null>) => {
    const n = new URLSearchParams(params);
    for (const [k, v] of Object.entries(p)) {
      if (v === null) n.delete(k);
      else n.set(k, v);
    }
    if (!('page' in p)) n.set('page', '1');
    router.replace(`${pathname}?${n}` as never);
  };
  const load = useCallback(() => {
    if (!org.organizationId || !access?.capabilities.readHr) return;
    const q = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
    });
    if (kind.success) q.set('kind', kind.data);
    if (status.success) q.set('status', status.data);
    const owner = params.get('ownerUserId')?.trim();
    const due = params.get('dueBefore');
    if (owner) q.set('ownerUserId', owner.slice(0, 200));
    if (due) q.set('dueBefore', due);
    void Promise.all([
      getJson(
        employeeChecklistsPath(org.organizationId, employeeId, q),
        new AbortController().signal,
      ).then((v) => employeeChecklistListSchema.parse(v)),
      getJson(
        employeePath(org.organizationId, employeeId),
        new AbortController().signal,
      ).then((v) => employeeDetailSchema.parse(v)),
    ])
      .then(([v, e]) => {
        setData(v);
        setEmployee(e);
        setState('ready');
      })
      .catch(() => setState('error'));
  }, [
    access?.capabilities.readHr,
    employeeId,
    kind.data,
    kind.success,
    org.organizationId,
    page,
    pageSize,
    params,
    status.data,
    status.success,
  ]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (!start || !org.organizationId || !employee) return;
    const q = new URLSearchParams({
      legalEntityId: employee.legalEntityId,
      active: 'true',
      page: '1',
      pageSize: '100',
    });
    void getJson(
      checklistTemplatesPath(org.organizationId, q),
      new AbortController().signal,
    )
      .then((v) => checklistTemplateListSchema.parse(v))
      .then(setTemplates)
      .catch(() => setTemplates(undefined));
  }, [employee, org.organizationId, start]);
  const rows = data?.items ?? [];
  const selected = selectedId.success
    ? (rows.find((x) => x.id === selectedId.data) ?? null)
    : null;
  const submitStart = async () => {
    if (!org.organizationId) return;
    try {
      await sendHrJson(
        employeeChecklistsPath(org.organizationId, employeeId),
        'POST',
        createEmployeeChecklistSchema.parse({
          templateId,
          relationshipId: relationshipId || null,
          startedOn,
          ownerUserId,
        }),
        checklistSchema,
      );
      setStart(false);
      setTemplateId('');
      setRelationshipId('');
      setStartedOn('');
      setOwnerUserId('');
      notify({ kind: 'success', title: t('checklists.checklistStarted') });
      load();
    } catch (e) {
      setError(
        e instanceof HrRequestError && e.status === 409
          ? 'conflict'
          : 'general',
      );
    }
  };
  const submitTask = async () => {
    if (!org.organizationId || !task || !command || !selected) return;
    try {
      await sendHrJson(
        checklistTaskPath(org.organizationId, employeeId, selected.id, task.id),
        'PATCH',
        updateChecklistTaskSchema.parse({
          status: command,
          ...(command === 'skipped'
            ? { skipReason }
            : documentId
              ? { documentId }
              : {}),
        }),
        checklistTaskSchema,
      );
      setTask(null);
      setCommand(null);
      setDocumentId('');
      setSkipReason('');
      notify({ kind: 'success', title: t('checklists.checklistUpdated') });
      load();
    } catch (e) {
      setError(
        e instanceof HrRequestError && e.status === 409
          ? 'conflict'
          : 'general',
      );
    }
  };
  if (accessState === 'loading' || org.state === 'loading')
    return (
      <PageContainer>
        <InlineNotification
          kind="info"
          hideCloseButton
          title={t('checklists.loading')}
        />
      </PageContainer>
    );
  if (accessState === 'error' || org.state === 'error' || state === 'error')
    return (
      <PageContainer>
        <InlineNotification
          kind="error"
          hideCloseButton
          title={t('checklists.error')}
        />
      </PageContainer>
    );
  if (!access?.capabilities.readHr)
    return (
      <PageContainer>
        <InlineNotification
          kind="error"
          hideCloseButton
          title={t('checklists.denied')}
        />
      </PageContainer>
    );
  return (
    <PageContainer>
      <Stack gap={6}>
        <EmployeeTabs />
        <Heading>{t('checklists.workflows')}</Heading>
        <Stack gap={4}>
          <Select
            id="kind"
            labelText={t('checklists.kind')}
            value={kind.success ? kind.data : ''}
            onChange={(e) => replace({ kind: e.target.value || null })}
          >
            <SelectItem value="" text={t('checklists.all')} />
            {checklistKindSchema.options.map((v) => (
              <SelectItem key={v} value={v} text={v} />
            ))}
          </Select>
          <Select
            id="status"
            labelText={t('checklists.status')}
            value={status.success ? status.data : ''}
            onChange={(e) => replace({ status: e.target.value || null })}
          >
            <SelectItem value="" text={t('checklists.all')} />
            {checklistStatusSchema.options.map((v) => (
              <SelectItem key={v} value={v} text={v} />
            ))}
          </Select>
          <TextInput
            id="owner"
            labelText={t('checklists.owner')}
            value={params.get('ownerUserId') ?? ''}
            onChange={(e) => replace({ ownerUserId: e.target.value || null })}
          />
          <TextInput
            id="due"
            labelText={t('checklists.dueBefore')}
            type="date"
            value={params.get('dueBefore') ?? ''}
            onChange={(e) => replace({ dueBefore: e.target.value || null })}
          />
          {access.capabilities.manageHr ? (
            <Button
              onClick={() => {
                setError(null);
                setStart(true);
              }}
            >
              {t('checklists.startChecklist')}
            </Button>
          ) : null}
        </Stack>
        <DataGrid
          columns={[
            { key: 'kind', header: t('checklists.kind') },
            { key: 'status', header: t('checklists.status') },
            { key: 'startedOn', header: t('checklists.startDate') },
          ]}
          rows={rows.map((row) => ({
            id: row.id,
            kind: row.kind,
            startedOn: row.startedOn,
            status: row.status,
          }))}
          pagination
          paginationMode="server"
          page={page}
          pageSize={pageSize}
          totalItems={data?.total ?? 0}
          onPageChange={(p, s) =>
            replace({ page: String(p), pageSize: String(s) })
          }
          state={rows.length ? 'ready' : 'empty'}
          {...(access.capabilities.manageHr
            ? {
                onRowClick: (r: { id: string }) =>
                  replace({ checklistId: r.id }),
              }
            : {})}
        />
        {selected ? (
          <>
            <Heading>{t('checklists.tasks')}</Heading>
            <DataGrid
              columns={[
                { key: 'title', header: t('checklists.task') },
                { key: 'ownerUserId', header: t('checklists.owner') },
                { key: 'dueOn', header: t('checklists.due') },
                { key: 'status', header: t('checklists.status') },
              ]}
              rows={selected.tasks}
              state={selected.tasks.length ? 'ready' : 'empty'}
              {...(access.capabilities.manageHr
                ? {
                    onRowClick: (r: { id: string }) => {
                      const value =
                        selected.tasks.find((x) => x.id === r.id) ?? null;
                      if (
                        value &&
                        (value.status === 'pending' ||
                          value.status === 'in_progress')
                      ) {
                        setTask(value);
                        setCommand(
                          value.status === 'pending'
                            ? 'in_progress'
                            : 'completed',
                        );
                        setError(null);
                      }
                    },
                  }
                : {})}
            />
          </>
        ) : null}
        <Modal
          open={start}
          modalHeading={t('checklists.startChecklist')}
          primaryButtonText={t('checklists.start')}
          secondaryButtonText={t('checklists.cancel')}
          onRequestClose={() => {
            setStart(false);
            setTemplateId('');
            setRelationshipId('');
            setStartedOn('');
            setOwnerUserId('');
            setError(null);
          }}
          onRequestSubmit={() => void submitStart()}
        >
          <Stack gap={4}>
            {error ? (
              <InlineNotification
                kind="error"
                hideCloseButton
                title={
                  error === 'conflict'
                    ? t('checklists.conflict')
                    : t('checklists.pageError')
                }
              />
            ) : null}
            <Select
              id="template"
              labelText={t('checklists.template')}
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
            >
              <SelectItem value="" text={t('checklists.selectTemplate')} />
              {templates?.items.map((x) => (
                <SelectItem key={x.id} value={x.id} text={x.name} />
              ))}
            </Select>
            <Select
              id="relationship"
              labelText={t('checklists.relationship')}
              value={relationshipId}
              onChange={(e) => setRelationshipId(e.target.value)}
            >
              <SelectItem value="" text={t('checklists.noRelationship')} />
              {employee?.relationships.map((relationship) => (
                <SelectItem
                  key={relationship.id}
                  value={relationship.id}
                  text={`${relationship.kind}: ${relationship.position}`}
                />
              ))}
            </Select>
            <TextInput
              id="started"
              type="date"
              labelText={t('checklists.startDate')}
              value={startedOn}
              onChange={(e) => setStartedOn(e.target.value)}
            />
            <TextInput
              id="owner-user"
              labelText={t('checklists.owner')}
              value={ownerUserId}
              onChange={(e) => setOwnerUserId(e.target.value)}
            />
          </Stack>
        </Modal>
        <Modal
          open={task !== null}
          modalHeading={t('checklists.task')}
          primaryButtonText={t('checklists.save')}
          secondaryButtonText={t('checklists.cancel')}
          onRequestClose={() => {
            setTask(null);
            setCommand(null);
            setDocumentId('');
            setSkipReason('');
            setError(null);
          }}
          onRequestSubmit={() => void submitTask()}
        >
          <Stack gap={4}>
            {error ? (
              <InlineNotification
                kind="error"
                hideCloseButton
                title={
                  error === 'conflict'
                    ? t('checklists.conflict')
                    : t('checklists.pageError')
                }
              />
            ) : null}
            <Select
              id="command"
              labelText={t('checklists.command')}
              value={command ?? ''}
              onChange={(e) => setCommand(e.target.value as typeof command)}
            >
              {task?.status === 'pending' ? (
                <SelectItem value="in_progress" text={t('checklists.start')} />
              ) : null}
              {task?.status === 'in_progress' ? (
                <SelectItem value="completed" text={t('checklists.complete')} />
              ) : null}
              <SelectItem value="skipped" text={t('checklists.skip')} />
            </Select>
            {command === 'completed' && task?.documentCategoryId ? (
              <TextInput
                id="document"
                labelText={t('checklists.documentId')}
                value={documentId}
                onChange={(e) => setDocumentId(e.target.value)}
              />
            ) : null}
            {command === 'skipped' ? (
              <TextInput
                id="reason"
                labelText={t('checklists.skipReason')}
                value={skipReason}
                onChange={(e) => setSkipReason(e.target.value)}
              />
            ) : null}
          </Stack>
        </Modal>
      </Stack>
    </PageContainer>
  );
}
