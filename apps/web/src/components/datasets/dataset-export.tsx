'use client';

import { Download } from '@bap/design-system/icons';
import {
  Button,
  Heading,
  InlineNotification,
  Section,
  Stack,
} from '@bap/design-system/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { datasetPath } from '../../lib/datasets/client';

// CSV and XLSX only: ADR 0005 rejects PDF, so no third control exists.
type ExportFormat = 'csv' | 'xlsx';

// The saved name is built from a dataset identifier, never from stored text such as a dataset name.
const datasetIdSchema = z.string().uuid();

type DatasetExportProps = Readonly<{
  datasetId: string;
  organizationId: string;
}>;

export function DatasetExport({
  datasetId,
  organizationId,
}: DatasetExportProps) {
  const { t } = useTranslation();
  const [state, setState] = useState<'error' | 'idle'>('idle');

  function download(format: ExportFormat): void {
    const parsed = datasetIdSchema.safeParse(datasetId);

    if (!parsed.success) {
      setState('error');
      return;
    }

    // The browser writes the attachment straight to disk, so the tab never holds the export at all.
    const anchor = document.createElement('a');
    anchor.download = `dataset-${parsed.data}.${format}`;
    anchor.href = `${datasetPath(organizationId, parsed.data)}/export?format=${format}`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setState('idle');
  }

  // A section of its own, so the heading takes the level below whatever encloses the panel.
  return (
    <Section>
      <Stack gap={5}>
        <Heading>{t('datasets.exportTitle')}</Heading>
        <Stack gap={3} orientation="horizontal">
          <Button
            kind="tertiary"
            onClick={() => {
              download('csv');
            }}
            renderIcon={Download}
            size="sm"
            type="button"
          >
            {t('datasets.exportCsv')}
          </Button>
          <Button
            kind="tertiary"
            onClick={() => {
              download('xlsx');
            }}
            renderIcon={Download}
            size="sm"
            type="button"
          >
            {t('datasets.exportXlsx')}
          </Button>
        </Stack>
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
