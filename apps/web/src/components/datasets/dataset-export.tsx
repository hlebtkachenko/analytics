'use client';

import { Download } from '@bap/design-system/icons';
import {
  Button,
  Heading,
  InlineLoading,
  InlineNotification,
  Section,
  Stack,
} from '@bap/design-system/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { datasetPath } from '../../lib/datasets/client';

// CSV and XLSX only: ADR 0005 rejects PDF, so no third control exists.
type ExportFormat = 'csv' | 'xlsx';

type DatasetExportProps = Readonly<{
  datasetId: string;
  organizationId: string;
}>;

export function DatasetExport({
  datasetId,
  organizationId,
}: DatasetExportProps) {
  const { t } = useTranslation();
  const [state, setState] = useState<'error' | 'idle' | 'loading'>('idle');

  async function download(format: ExportFormat): Promise<void> {
    setState('loading');
    try {
      const response = await fetch(
        `${datasetPath(organizationId, datasetId)}/export?format=${format}`,
        { cache: 'no-store' },
      );

      if (!response.ok) {
        throw new Error('Export rejected.');
      }

      // The browser saves the body from an object URL, so no response header is rendered as page text.
      const objectUrl = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.download = `dataset-${datasetId}.${format}`;
      anchor.href = objectUrl;
      anchor.click();
      URL.revokeObjectURL(objectUrl);
      setState('idle');
    } catch {
      setState('error');
    }
  }

  // A section of its own, so the heading takes the level below whatever encloses the panel.
  return (
    <Section>
      <Stack gap={5}>
        <Heading>{t('datasets.exportTitle')}</Heading>
        <Stack gap={3} orientation="horizontal">
          <Button
            kind="tertiary"
            onClick={() => void download('csv')}
            renderIcon={Download}
            size="sm"
            type="button"
          >
            {t('datasets.exportCsv')}
          </Button>
          <Button
            kind="tertiary"
            onClick={() => void download('xlsx')}
            renderIcon={Download}
            size="sm"
            type="button"
          >
            {t('datasets.exportXlsx')}
          </Button>
        </Stack>
        {state === 'loading' ? (
          <InlineLoading description={t('datasets.exportWaiting')} />
        ) : null}
        {state === 'error' ? (
          <InlineNotification
            kind="error"
            lowContrast
            title={t('datasets.exportFailed')}
          />
        ) : null}
      </Stack>
    </Section>
  );
}
