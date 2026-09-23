'use client';
import { InlineNotification, Stack, TextInput } from '@bap/design-system/react';
import { DataGrid } from '@bap/design-system/blocks';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import PageContainer from '../../../../components/page-container';
import { listMyHrPayslips } from '../../../../lib/hr-self-service/client';
import { useMyHr } from '../my-hr-state';
export default function MyHrPayslipsPage() {
  const { t } = useTranslation();
  const { organization, state: accessState } = useMyHr();
  const [items, setItems] = useState<
    Awaited<ReturnType<typeof listMyHrPayslips>>['items']
  >([]);
  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading');
  const [fromMonth, setFromMonth] = useState('');
  const [toMonth, setToMonth] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  useEffect(() => {
    if (accessState !== 'ready') return;
    void listMyHrPayslips(organization.organizationId, {
      page,
      pageSize: 25,
      fromMonth: fromMonth || undefined,
      toMonth: toMonth || undefined,
    })
      .then((x) => {
        setItems(x.items);
        setTotal(x.total);
        setState('ready');
      })
      .catch(() => setState('error'));
  }, [accessState, organization.organizationId, page, fromMonth, toMonth]);
  const notice =
    accessState === 'error'
      ? t('myHr.accessError')
      : accessState === 'unavailable'
        ? t('myHr.revoked')
        : state === 'error'
          ? t('myHr.error')
          : undefined;
  return (
    <PageContainer>
      <Stack gap={6}>
        <h1>{t('myHr.payslips')}</h1>
        <TextInput
          id="my-hr-from-month"
          labelText={t('myHr.periodStart')}
          type="month"
          value={fromMonth}
          onChange={(e) => {
            setPage(1);
            setFromMonth(e.target.value);
          }}
        />
        <TextInput
          id="my-hr-to-month"
          labelText={t('myHr.periodEnd')}
          type="month"
          value={toMonth}
          onChange={(e) => {
            setPage(1);
            setToMonth(e.target.value);
          }}
        />
        {notice ? (
          <InlineNotification
            kind={accessState === 'unavailable' ? 'warning' : 'error'}
            title={notice}
            hideCloseButton
          />
        ) : (
          <DataGrid
            columns={[
              { key: 'month', header: t('myHr.month') },
              { key: 'version', header: t('myHr.version') },
              { key: 'status', header: t('myHr.status') },
              { key: 'documentId', header: t('myHr.document') },
              { key: 'finalizedAt', header: t('myHr.date') },
              { key: 'paidAt', header: t('myHr.paidAt') },
            ]}
            rows={items.map((x) => ({ ...x, id: x.payrollRunId }))}
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
          />
        )}
      </Stack>
    </PageContainer>
  );
}
