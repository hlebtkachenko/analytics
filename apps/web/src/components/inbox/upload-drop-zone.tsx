'use client';

import {
  FileUploaderDropContainer,
  InlineLoading,
  Link,
  StructuredListBody,
  StructuredListCell,
  StructuredListHead,
  StructuredListRow,
  StructuredListWrapper,
  Tag,
} from '@bap/design-system/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { uploadInboxFile } from '../../lib/inbox/client';
import type { UploadOutcome } from '../../lib/inbox/client';

type UploadRow = Readonly<{
  fileName: string;
  key: string;
  outcome: UploadOutcome | 'pending';
}>;

type Props = Readonly<{
  itemHref: (itemId: string) => string;
  onUploaded: () => void;
  organizationId: string;
}>;

let nextUploadKey = 0;

// Every dropped file is one request, sent in order, so a refused file never blocks the others.
export default function UploadDropZone({
  itemHref,
  onUploaded,
  organizationId,
}: Props) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<UploadRow[]>([]);
  const [busy, setBusy] = useState(false);

  async function uploadAll(files: readonly File[]): Promise<void> {
    if (files.length === 0 || busy) {
      return;
    }
    const pending = files.map((file) => {
      nextUploadKey += 1;
      return {
        fileName: file.name,
        key: `upload-${String(nextUploadKey)}`,
        outcome: 'pending' as const,
      };
    });
    setRows((current) => [...pending, ...current]);
    setBusy(true);

    let uploaded = false;
    for (const [index, file] of files.entries()) {
      const outcome = await uploadInboxFile(organizationId, file);
      uploaded ||= outcome.kind !== 'refused';
      const key = pending[index]!.key;
      setRows((current) =>
        current.map((row) => (row.key === key ? { ...row, outcome } : row)),
      );
    }

    setBusy(false);
    if (uploaded) {
      onUploaded();
    }
  }

  return (
    <section aria-label={t('inbox.uploadTitle')}>
      <FileUploaderDropContainer
        disabled={busy || organizationId.length === 0}
        labelText={t('inbox.dropZone')}
        multiple
        name="file"
        onAddFiles={(_event, content) => {
          void uploadAll(content.addedFiles);
        }}
      />
      <p>{t('inbox.dropZoneDescription')}</p>
      {rows.length > 0 ? (
        <StructuredListWrapper aria-label={t('inbox.uploadResults')}>
          <StructuredListHead>
            <StructuredListRow head>
              <StructuredListCell head>
                {t('inbox.columnFileName')}
              </StructuredListCell>
              <StructuredListCell head>
                {t('inbox.columnStatus')}
              </StructuredListCell>
            </StructuredListRow>
          </StructuredListHead>
          <StructuredListBody>
            {rows.map((row) => (
              <StructuredListRow key={row.key}>
                <StructuredListCell>{row.fileName}</StructuredListCell>
                <StructuredListCell>
                  <UploadResult itemHref={itemHref} outcome={row.outcome} />
                </StructuredListCell>
              </StructuredListRow>
            ))}
          </StructuredListBody>
        </StructuredListWrapper>
      ) : null}
    </section>
  );
}

function UploadResult({
  itemHref,
  outcome,
}: Readonly<{
  itemHref: (itemId: string) => string;
  outcome: UploadOutcome | 'pending';
}>) {
  const { t } = useTranslation();

  if (outcome === 'pending') {
    return <InlineLoading description={t('inbox.uploading')} />;
  }
  if (outcome.kind === 'created') {
    return (
      <Link href={itemHref(outcome.itemId)}>{t('inbox.uploadCreated')}</Link>
    );
  }
  if (outcome.kind === 'duplicate') {
    return (
      <Link href={itemHref(outcome.duplicateOfItemId)}>
        {t('inbox.uploadDuplicate')}
      </Link>
    );
  }
  return (
    <Tag size="sm" type="red">
      {t(refusalLabelKeys[outcome.reason])}
    </Tag>
  );
}

const refusalLabelKeys = {
  denied: 'inbox.uploadRefusedDenied',
  failed: 'inbox.uploadRefusedFailed',
  too_large: 'inbox.uploadRefusedTooLarge',
} as const;
