'use client';
import { InlineNotification, Stack } from '@bap/design-system/react';
import { DataGrid } from '@bap/design-system/blocks';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import PageContainer from '../../../../components/page-container';
import { listMyHrDocuments } from '../../../../lib/hr-self-service/client';
import { useMyHr } from '../my-hr-state';
export default function MyHrDocumentsPage() {
  const { t } = useTranslation();
  const { organization, state: accessState } = useMyHr();
  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading');
  const [items, setItems] = useState<
    Awaited<ReturnType<typeof listMyHrDocuments>>['items']
  >([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  useEffect(() => {
    if (accessState !== 'ready') return;
    void listMyHrDocuments(organization.organizationId, { page, pageSize: 25 })
      .then((x) => {
        setItems(x.items);
        setTotal(x.total);
        setState('ready');
      })
      .catch(() => setState('error'));
  }, [accessState, organization.organizationId, page]);
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
        <h1>{t('myHr.documents')}</h1>
        {notice ? (
          <InlineNotification
            kind={accessState === 'unavailable' ? 'warning' : 'error'}
            title={notice}
            hideCloseButton
          />
        ) : (
          <DataGrid
            columns={[
              { key: 'title', header: t('myHr.document') },
              { key: 'documentDate', header: t('myHr.documentDate') },
              { key: 'categoryId', header: t('myHr.category') },
              { key: 'relationshipId', header: t('myHr.relationship') },
              { key: 'approvalStatus', header: t('myHr.approval') },
              { key: 'approvedAt', header: t('myHr.approvedAt') },
            ]}
            rows={items.map((x) => ({ ...x, id: x.documentId }))}
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
