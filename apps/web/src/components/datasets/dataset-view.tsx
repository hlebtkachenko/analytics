'use client';

import {
  Button,
  Heading,
  InlineLoading,
  InlineNotification,
  Section,
  Stack,
} from '@bap/design-system/react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  DATASET_PAGE_SIZE,
  datasetPath,
  datasetRowPageSchema,
  getJson,
  isAbortError,
} from '../../lib/datasets/client';
import type { DatasetRowPage, DatasetSummary } from '../../lib/datasets/client';
import { DatasetChart } from './dataset-chart';
import { DatasetChat } from './dataset-chat';
import { DatasetExport } from './dataset-export';
import { DatasetTable } from './dataset-table';

// One entry per visited page: the server hands back the cursor, the browser never slices rows itself.
type PageRequest = Readonly<{ after: number | undefined }>;

const firstPage: PageRequest = { after: undefined };

type DatasetViewProps = Readonly<{
  dataset: DatasetSummary;
  onClose: () => void;
  organizationId: string;
  useAi: boolean;
}>;

export function DatasetView({
  dataset,
  onClose,
  organizationId,
  useAi,
}: DatasetViewProps) {
  const { t } = useTranslation();
  const [requests, setRequests] = useState<readonly PageRequest[]>([firstPage]);
  const [page, setPage] = useState<DatasetRowPage>();
  const [state, setState] = useState<'error' | 'idle' | 'loading'>('loading');
  const current = requests[requests.length - 1] ?? firstPage;

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams();

    if (current.after !== undefined) {
      query.set('after', String(current.after));
    }

    query.set('pageSize', String(DATASET_PAGE_SIZE));
    void getJson(
      `${datasetPath(organizationId, dataset.id)}/rows?${query.toString()}`,
      controller.signal,
    )
      .then((payload) => datasetRowPageSchema.parse(payload))
      .then((loaded) => {
        setPage(loaded);
        setState('idle');
      })
      .catch((error: unknown) => {
        if (!isAbortError(error)) {
          setPage(undefined);
          setState('error');
        }
      });
    return () => {
      controller.abort();
    };
  }, [current, dataset.id, organizationId]);

  const nextCursor = page?.nextCursor ?? undefined;
  // While a page is in flight the cursor on screen is the previous page's, so no control may act on it.
  const paging = state === 'loading';

  function showNextPage(): void {
    if (paging || nextCursor === undefined) {
      return;
    }

    setState('loading');
    setRequests((previous) => [...previous, { after: nextCursor }]);
  }

  function showPreviousPage(): void {
    if (paging || requests.length === 1) {
      return;
    }

    setState('loading');
    setRequests((previous) => previous.slice(0, -1));
  }

  // The open dataset sits under the page heading, so every panel below it renders one level deeper.
  return (
    <Section level={2}>
      <Stack gap={7}>
        <Stack gap={3} orientation="horizontal">
          <Heading>{dataset.name}</Heading>
          <Button kind="ghost" onClick={onClose} size="sm" type="button">
            {t('datasets.close')}
          </Button>
        </Stack>
        {state === 'loading' ? (
          <InlineLoading description={t('datasets.rowsLoading')} />
        ) : null}
        {state === 'error' ? (
          <InlineNotification
            kind="error"
            lowContrast
            title={t('datasets.rowsError')}
          />
        ) : null}
        {page !== undefined && page.rows.length === 0 ? (
          <InlineNotification
            kind="info"
            lowContrast
            title={t('datasets.rowsEmpty')}
          />
        ) : null}
        {page !== undefined && page.rows.length > 0 ? (
          <DatasetTable columns={page.columns} rows={page.rows} />
        ) : null}
        {page !== undefined && page.rows.length > 0 ? (
          <Stack gap={3} orientation="horizontal">
            <Button
              disabled={paging || requests.length === 1}
              kind="tertiary"
              onClick={showPreviousPage}
              size="sm"
              type="button"
            >
              {t('datasets.previousPage')}
            </Button>
            <Button
              disabled={paging || nextCursor === undefined}
              kind="tertiary"
              onClick={showNextPage}
              size="sm"
              type="button"
            >
              {t('datasets.nextPage')}
            </Button>
            <p aria-live="polite">
              {t('datasets.pageStatus', { page: requests.length })}
            </p>
          </Stack>
        ) : null}
        {page !== undefined && page.rows.length > 0 ? (
          <DatasetChart columns={page.columns} rows={page.rows} />
        ) : null}
        <DatasetExport datasetId={dataset.id} organizationId={organizationId} />
        {useAi ? (
          <DatasetChat
            datasetId={dataset.id}
            datasetName={dataset.name}
            organizationId={organizationId}
          />
        ) : (
          <InlineNotification
            kind="info"
            lowContrast
            title={t('datasets.chatUnavailable')}
          />
        )}
      </Stack>
    </Section>
  );
}
