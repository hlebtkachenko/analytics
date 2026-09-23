'use client';
import {
  Button,
  InlineNotification,
  Modal,
  Select,
  SelectItem,
  Stack,
  TextInput,
} from '@bap/design-system/react';
import { DataGrid } from '@bap/design-system/blocks';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import PageContainer from '../../../../components/page-container';
import { useToast } from '../../../../components/shell/toast';
import {
  createMyHrTimesheet,
  listMyHrTimesheets,
  submitMyHrTimesheet,
  updateMyHrTimesheet,
} from '../../../../lib/hr-self-service/client';
import { useMyHr } from '../my-hr-state';
export default function MyHrTimePage() {
  const { t } = useTranslation();
  const { notify } = useToast();
  const { organization, profile, state: accessState } = useMyHr();
  const [items, setItems] = useState<
    Awaited<ReturnType<typeof listMyHrTimesheets>>['items']
  >([]);
  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string>();
  const [form, setForm] = useState({
    relationshipId: '',
    periodStart: '',
    periodEnd: '',
    workDate: '',
    startsAt: '',
    endsAt: '',
  });
  const load = () => {
    if (accessState !== 'ready') return;
    void listMyHrTimesheets(organization.organizationId, { page, pageSize: 25 })
      .then((x) => {
        setItems(x.items);
        setTotal(x.total);
        setState('ready');
      })
      .catch(() => setState('error'));
  };
  useEffect(load, [accessState, organization.organizationId, page]);
  const save = () => {
    const body = {
      relationshipId: form.relationshipId,
      periodStart: form.periodStart,
      periodEnd: form.periodEnd,
      entries: [
        {
          workDate: form.workDate,
          startedAt: new Date(form.startsAt).toISOString(),
          endedAt: new Date(form.endsAt).toISOString(),
        },
      ],
    };
    void (
      editing
        ? updateMyHrTimesheet(organization.organizationId, editing, {
            entries: body.entries,
          })
        : createMyHrTimesheet(organization.organizationId, body)
    )
      .then(() => {
        setOpen(false);
        notify({ kind: 'success', title: t('myHr.timeSaved') });
        load();
      })
      .catch(() => setState('error'));
  };
  const notice =
    accessState === 'error'
      ? t('myHr.accessError')
      : accessState === 'unavailable'
        ? t('myHr.revoked')
        : state === 'error'
          ? t('myHr.error')
          : undefined;
  const canCreate =
    accessState === 'ready' && Boolean(profile?.relationships.length);
  const formValid = Boolean(
    form.relationshipId &&
    form.periodStart &&
    form.periodEnd &&
    form.workDate &&
    form.startsAt &&
    form.endsAt,
  );
  return (
    <PageContainer>
      <Stack gap={6}>
        <h1>{t('myHr.time')}</h1>
        <Button
          disabled={!canCreate}
          onClick={() => {
            setEditing(undefined);
            setForm({
              relationshipId: profile?.relationships[0]?.id ?? '',
              periodStart: '',
              periodEnd: '',
              workDate: '',
              startsAt: '',
              endsAt: '',
            });
            setOpen(true);
          }}
        >
          {t('myHr.create')}
        </Button>
        {notice ? (
          <InlineNotification
            kind={accessState === 'unavailable' ? 'warning' : 'error'}
            title={notice}
            hideCloseButton
          />
        ) : (
          <DataGrid
            columns={[
              { key: 'periodStart', header: t('myHr.periodStart') },
              { key: 'periodEnd', header: t('myHr.periodEnd') },
              { key: 'status', header: t('myHr.status') },
              { key: 'totalWorkedMinutes', header: t('myHr.time') },
            ]}
            rows={items.map((item) => ({
              id: item.id,
              periodEnd: item.periodEnd,
              periodStart: item.periodStart,
              status: item.status,
              totalWorkedMinutes: item.totalWorkedMinutes,
            }))}
            state={
              accessState === 'loading' || state === 'loading'
                ? 'loading'
                : items.length
                  ? 'ready'
                  : 'empty'
            }
            emptyLabel={t('myHr.empty')}
            errorLabel={t('myHr.error')}
            pagination
            paginationMode="server"
            page={page}
            pageSize={25}
            totalItems={total}
            onPageChange={(next) => setPage(next)}
            rowActions={(row) =>
              row.status === 'draft'
                ? [
                    {
                      id: 'edit',
                      label: t('myHr.edit'),
                      onClick: () => {
                        const item = items.find((x) => x.id === row.id);
                        const entry = item?.entries[0];
                        if (!item || !entry) return;
                        setEditing(item.id);
                        setForm({
                          relationshipId: item.relationshipId,
                          periodStart: item.periodStart,
                          periodEnd: item.periodEnd,
                          workDate: entry.workDate,
                          startsAt: entry.startedAt.slice(0, 16),
                          endsAt: entry.endedAt.slice(0, 16),
                        });
                        setOpen(true);
                      },
                    },
                    {
                      id: 'submit',
                      label: t('myHr.submit'),
                      onClick: () =>
                        void submitMyHrTimesheet(
                          organization.organizationId,
                          row.id,
                        )
                          .then(() => {
                            notify({
                              kind: 'success',
                              title: t('myHr.timeSubmitted'),
                            });
                            load();
                          })
                          .catch(() => setState('error')),
                    },
                  ]
                : []
            }
          />
        )}
        <Modal
          open={open}
          modalHeading={t('myHr.time')}
          primaryButtonText={t('myHr.save')}
          primaryButtonDisabled={!formValid}
          secondaryButtonText={t('myHr.cancel')}
          onRequestClose={() => setOpen(false)}
          onRequestSubmit={save}
        >
          <Stack gap={4}>
            <Select
              id="my-hr-relationship"
              labelText={t('myHr.relationship')}
              value={form.relationshipId}
              onChange={(e) =>
                setForm({ ...form, relationshipId: e.target.value })
              }
            >
              {profile?.relationships.map((r) => (
                <SelectItem
                  key={r.id}
                  value={r.id}
                  text={`${r.position} (${r.kind})`}
                />
              ))}
            </Select>
            <TextInput
              id="my-hr-period-start"
              labelText={t('myHr.periodStart')}
              type="date"
              value={form.periodStart}
              onChange={(e) =>
                setForm({ ...form, periodStart: e.target.value })
              }
            />
            <TextInput
              id="my-hr-period-end"
              labelText={t('myHr.periodEnd')}
              type="date"
              value={form.periodEnd}
              onChange={(e) => setForm({ ...form, periodEnd: e.target.value })}
            />
            <TextInput
              id="my-hr-work-date"
              labelText={t('myHr.date')}
              type="date"
              value={form.workDate}
              onChange={(e) => setForm({ ...form, workDate: e.target.value })}
            />
            <TextInput
              id="my-hr-start"
              labelText={t('myHr.periodStart')}
              type="datetime-local"
              value={form.startsAt}
              onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
            />
            <TextInput
              id="my-hr-end"
              labelText={t('myHr.periodEnd')}
              type="datetime-local"
              value={form.endsAt}
              onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
            />
          </Stack>
        </Modal>
      </Stack>
    </PageContainer>
  );
}
