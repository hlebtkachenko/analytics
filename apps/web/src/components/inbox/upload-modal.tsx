'use client';

import {
  FileUploaderDropContainer,
  FileUploaderItem,
  Modal,
} from '@bap/design-system/react';
import type { ReactElement } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { uploadInboxFile } from '../../lib/inbox/client';
import type { UploadRefusal } from '../../lib/inbox/client';
import styles from './upload-modal.module.scss';

const uploadRefusalLabelKeys: Readonly<Record<UploadRefusal, string>> = {
  denied: 'inbox.uploadRefusedDenied',
  failed: 'inbox.uploadRefusedFailed',
  too_large: 'inbox.uploadRefusedTooLarge',
};

// One row per file added in this modal session; edit means refused, complete means accepted.
type UploadEntry = Readonly<{
  errorSubject?: string;
  id: string;
  name: string;
  status: 'complete' | 'edit' | 'uploading';
}>;

type UploadModalProps = Readonly<{
  initialFiles: readonly File[];
  onClose: () => void;
  onUploaded: () => void;
  organizationId: string;
}>;

export function UploadModal({
  initialFiles,
  onClose,
  onUploaded,
  organizationId,
}: UploadModalProps): ReactElement {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<readonly UploadEntry[]>([]);
  const nextId = useRef(0);

  // Each file uploads on its own; a refused file only marks its own row, never the others.
  const addFiles = useCallback(
    (files: readonly File[]): void => {
      if (organizationId.length === 0) {
        return;
      }
      for (const file of files) {
        const id = `upload-${String(nextId.current)}`;
        nextId.current += 1;
        setEntries((prev) => [
          ...prev,
          { id, name: file.name, status: 'uploading' },
        ]);
        void uploadInboxFile(organizationId, file).then((outcome) => {
          setEntries((prev) =>
            prev.map((entry) =>
              entry.id === id
                ? outcome.kind === 'refused'
                  ? {
                      ...entry,
                      errorSubject: t(uploadRefusalLabelKeys[outcome.reason]),
                      status: 'edit',
                    }
                  : { ...entry, status: 'complete' }
                : entry,
            ),
          );
          if (outcome.kind !== 'refused') {
            onUploaded();
          }
        });
      }
    },
    [organizationId, onUploaded, t],
  );

  // Files dropped on the page open this modal already carrying them; enqueue them once on mount.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current) {
      return;
    }
    seeded.current = true;
    if (initialFiles.length > 0) {
      addFiles(initialFiles);
    }
  }, [addFiles, initialFiles]);

  return (
    <Modal
      modalHeading={t('inbox.uploadTitle')}
      onRequestClose={onClose}
      open
      passiveModal
      size="sm"
    >
      <p className={styles.intro!}>{t('inbox.uploadModalDescription')}</p>
      <FileUploaderDropContainer
        labelText={t('inbox.uploadDropLabel')}
        multiple
        onAddFiles={(_event, { addedFiles }) => {
          addFiles([...addedFiles]);
        }}
      />
      {entries.length > 0 ? (
        <div className={styles.items!}>
          {entries.map((entry) => (
            <FileUploaderItem
              {...(entry.errorSubject === undefined
                ? {}
                : { errorSubject: entry.errorSubject })}
              iconDescription={t(
                entry.status === 'edit'
                  ? 'inbox.uploadItemRemove'
                  : entry.status === 'complete'
                    ? 'inbox.uploadItemComplete'
                    : 'inbox.uploading',
              )}
              invalid={entry.status === 'edit'}
              key={entry.id}
              name={entry.name}
              onDelete={() => {
                setEntries((prev) =>
                  prev.filter((other) => other.id !== entry.id),
                );
              }}
              status={entry.status}
              uuid={entry.id}
            />
          ))}
        </div>
      ) : null}
    </Modal>
  );
}
