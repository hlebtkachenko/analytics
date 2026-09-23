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
  cancelMyHrLeaveRequest,
  createMyHrLeaveRequest,
  listMyHrLeaveRequests,
  listMyHrLeaveTypes,
} from '../../../../lib/hr-self-service/client';
import { useMyHr } from '../my-hr-state';
export default function MyHrLeavePage() {
  const { t } = useTranslation();
  const { notify } = useToast();
  const { organization, profile, state: accessState } = useMyHr();
  const [items, setItems] = useState<
    Awaited<ReturnType<typeof listMyHrLeaveRequests>>['items']
  >([]);
  const [types, setTypes] = useState<
    Awaited<ReturnType<typeof listMyHrLeaveTypes>>['items']
  >([]);
  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    relationshipId: '',
    leaveTypeId: '',
    startsOn: '',
    endsOn: '',
    requestedAmount: '',
  });
  const load = () => {
    if (accessState !== 'ready') return;
    void Promise.all([
      listMyHrLeaveRequests(organization.organizationId, {
        page,
        pageSize: 25,
      }),
      listMyHrLeaveTypes(organization.organizationId, {
        page: 1,
        pageSize: 100,
      }),
    ])
      .then(([requests, leaveTypes]) => {
        setItems(requests.items);
        setTotal(requests.total);
        setTypes(leaveTypes.items);
        setState('ready');
      })
      .catch(() => setState('error'));
  };
  useEffect(load, [accessState, organization.organizationId, page]);
  const notice =
    accessState === 'error'
      ? t('myHr.accessError')
      : accessState === 'unavailable'
        ? t('myHr.revoked')
        : state === 'error'
          ? t('myHr.error')
          : undefined;
  const canCreate =
    accessState === 'ready' &&
    Boolean(profile?.relationships.length && types.length);
  const formValid = Boolean(
    form.relationshipId &&
    form.leaveTypeId &&
    form.startsOn &&
    form.endsOn &&
    form.requestedAmount,
  );
  return (
    <PageContainer>
      <Stack gap={6}>
        <h1>{t('myHr.leave')}</h1>
        <Button
          disabled={!canCreate}
          onClick={() => {
            setForm({
              relationshipId: profile?.relationships[0]?.id ?? '',
              leaveTypeId: types[0]?.id ?? '',
              startsOn: '',
              endsOn: '',
              requestedAmount: '',
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
              { key: 'startsOn', header: t('myHr.periodStart') },
              { key: 'endsOn', header: t('myHr.periodEnd') },
              { key: 'requestedAmount', header: t('myHr.leave') },
              { key: 'status', header: t('myHr.status') },
            ]}
            rows={items}
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
              row.status === 'requested' || row.status === 'approved'
                ? [
                    {
                      id: 'cancel',
                      label: t('myHr.cancel'),
                      onClick: () =>
                        void cancelMyHrLeaveRequest(
                          organization.organizationId,
                          row.id,
                        )
                          .then(() => {
                            notify({
                              kind: 'success',
                              title: t('myHr.leaveCancelled'),
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
          modalHeading={t('myHr.leave')}
          primaryButtonText={t('myHr.save')}
          primaryButtonDisabled={!formValid}
          secondaryButtonText={t('myHr.cancel')}
          onRequestClose={() => setOpen(false)}
          onRequestSubmit={() =>
            void createMyHrLeaveRequest(organization.organizationId, form)
              .then(() => {
                setOpen(false);
                notify({ kind: 'success', title: t('myHr.leaveSaved') });
                load();
              })
              .catch(() => setState('error'))
          }
        >
          <Stack gap={4}>
            <Select
              id="my-hr-leave-relationship"
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
            <Select
              id="my-hr-leave-type"
              labelText={t('myHr.leaveType')}
              value={form.leaveTypeId}
              onChange={(e) =>
                setForm({ ...form, leaveTypeId: e.target.value })
              }
            >
              {types.map((x) => (
                <SelectItem key={x.id} value={x.id} text={x.name} />
              ))}
            </Select>
            <TextInput
              id="my-hr-leave-start"
              labelText={t('myHr.periodStart')}
              type="date"
              value={form.startsOn}
              onChange={(e) => setForm({ ...form, startsOn: e.target.value })}
            />
            <TextInput
              id="my-hr-leave-end"
              labelText={t('myHr.periodEnd')}
              type="date"
              value={form.endsOn}
              onChange={(e) => setForm({ ...form, endsOn: e.target.value })}
            />
            <TextInput
              id="my-hr-leave-amount"
              labelText={t('myHr.leave')}
              value={form.requestedAmount}
              onChange={(e) =>
                setForm({ ...form, requestedAmount: e.target.value })
              }
            />
          </Stack>
        </Modal>
      </Stack>
    </PageContainer>
  );
}
