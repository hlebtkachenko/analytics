'use client';

import {
  Button,
  Form,
  InlineNotification,
  Stack,
  TextInput,
} from '@bap/design-system/react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useToast } from '../../../../components/shell/toast';
import { getJson, isAbortError } from '../../../../lib/datasets/client';
import {
  inboxSettingsPath,
  updateInboxSettings,
} from '../../../../lib/inbox/client';
import { inboxSettingsSchema } from '../../../../lib/inbox/contract.ts';
import type { InboxSettings } from '../../../../lib/inbox/contract.ts';
import styles from './storage-quota.module.scss';

const BYTES_PER_MEGABYTE = 1_000_000;

function megabytes(bytes: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(
    bytes / BYTES_PER_MEGABYTE,
  );
}

type LoadResult = Readonly<{ key: string; value?: InboxSettings }>;

type StorageQuotaProperties = Readonly<{
  canManageOrganization: boolean;
  organizationId: string;
}>;

// The inbox blob quota: an admin reads it, only an owner tightens it below the platform cap.
export default function StorageQuota({
  canManageOrganization,
  organizationId,
}: StorageQuotaProperties) {
  const { t } = useTranslation();
  const { notify } = useToast();
  const [refreshCount, setRefreshCount] = useState(0);
  const [result, setResult] = useState<LoadResult>();
  const [quota, setQuota] = useState('');
  const [quotaInvalid, setQuotaInvalid] = useState(false);
  const [quotaAboveCap, setQuotaAboveCap] = useState(false);
  const [writeFailed, setWriteFailed] = useState(false);

  const loadKey = `${organizationId}#${String(refreshCount)}`;

  useEffect(() => {
    const controller = new AbortController();
    void getJson(inboxSettingsPath(organizationId), controller.signal)
      .then((payload) => inboxSettingsSchema.parse(payload))
      .then((settings) => {
        setResult({ key: loadKey, value: settings });
        setQuota(
          settings.blobQuotaBytes === null
            ? ''
            : String(settings.blobQuotaBytes / BYTES_PER_MEGABYTE),
        );
      })
      .catch((error: unknown) => {
        if (!isAbortError(error)) {
          setResult({ key: loadKey });
        }
      });
    return () => {
      controller.abort();
    };
  }, [organizationId, loadKey]);

  const loaded = result?.key === loadKey ? result.value : undefined;
  const failed = result?.key === loadKey && result.value === undefined;

  async function saveQuota(blobQuotaBytes: number | null) {
    setWriteFailed(false);
    setQuotaAboveCap(false);
    const outcome = await updateInboxSettings(organizationId, {
      blobQuotaBytes,
    });
    if (outcome.kind === 'above_cap') {
      setQuotaAboveCap(true);
    } else if (outcome.kind === 'failed') {
      setWriteFailed(true);
    } else {
      notify({ kind: 'success', title: t('settings.storage.saveSuccess') });
      setRefreshCount((count) => count + 1);
    }
  }

  function submitQuota() {
    const trimmed = quota.trim();
    if (trimmed.length === 0) {
      setQuotaInvalid(false);
      void saveQuota(null);
      return;
    }
    const value = Number(trimmed);
    const valid = Number.isInteger(value) && value > 0;
    setQuotaInvalid(!valid);
    if (valid) {
      void saveQuota(value * BYTES_PER_MEGABYTE);
    }
  }

  const capMegabytes =
    loaded === undefined ? '' : megabytes(loaded.platformQuotaBytes);

  return (
    <section aria-labelledby="settings-storage-heading">
      <Stack gap={5}>
        <h2 id="settings-storage-heading">{t('settings.storage.title')}</h2>
        {failed ? (
          <InlineNotification
            kind="error"
            lowContrast
            role="alert"
            title={t('settings.storage.error')}
          />
        ) : null}
        {writeFailed ? (
          <InlineNotification
            kind="error"
            lowContrast
            role="alert"
            title={t('settings.storage.writeFailed')}
          />
        ) : null}
        {quotaAboveCap ? (
          <InlineNotification
            kind="error"
            lowContrast
            role="alert"
            title={t('settings.storage.aboveCap', { cap: capMegabytes })}
          />
        ) : null}
        {loaded === undefined ? null : canManageOrganization ? (
          <Form
            aria-label={t('settings.storage.title')}
            className={styles.form!}
            onSubmit={(event) => {
              event.preventDefault();
              submitQuota();
            }}
          >
            <Stack gap={5}>
              <TextInput
                helperText={t('settings.storage.help', {
                  cap: capMegabytes,
                  used: megabytes(loaded.usedBytes),
                })}
                id="settings-storage-quota"
                inputMode="numeric"
                invalid={quotaInvalid}
                invalidText={t('settings.storage.invalid')}
                labelText={t('settings.storage.label')}
                onChange={(event) => {
                  setQuota(event.target.value);
                }}
                value={quota}
              />
              <div className={styles.actions!}>
                <Button kind="primary" size="md" type="submit">
                  {t('settings.storage.save')}
                </Button>
                <Button
                  disabled={loaded.blobQuotaBytes === null}
                  kind="ghost"
                  onClick={() => {
                    setQuota('');
                    setQuotaInvalid(false);
                    void saveQuota(null);
                  }}
                  size="md"
                  type="button"
                >
                  {t('settings.storage.useDefault')}
                </Button>
              </div>
            </Stack>
          </Form>
        ) : (
          <p>
            {t('settings.storage.label')}:{' '}
            {loaded.blobQuotaBytes === null
              ? t('settings.storage.platformDefault')
              : megabytes(loaded.blobQuotaBytes)}
            {'. '}
            {t('settings.storage.help', {
              cap: capMegabytes,
              used: megabytes(loaded.usedBytes),
            })}
          </p>
        )}
      </Stack>
    </section>
  );
}
