'use client';

import {
  Button,
  FileUploader,
  InlineLoading,
  InlineNotification,
  Select,
  SelectItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from '@bap/design-system/react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { DatasetView } from '../../components/datasets/dataset-view';
import {
  datasetListSchema,
  datasetsPath,
  getJson,
  isAbortError,
  uploadsPath,
} from '../../lib/datasets/client';
import type { DatasetSummary } from '../../lib/datasets/client';

const organizationsSchema = z.array(
  z.object({
    id: z.string().min(1),
    name: z.string().min(1),
  }),
);
// Mirrors the access contract the BFF validated; only the gated capabilities are read back.
const accessSchema = z.object({
  capabilities: z.object({
    manageGrants: z.boolean(),
    manageMembers: z.boolean(),
    uploadData: z.boolean(),
    useAi: z.boolean(),
  }),
  organizationId: z.string().min(1),
});

const statusLabels = {
  failed: 'datasets.statusFailed',
  importing: 'datasets.statusImporting',
  ready: 'datasets.statusReady',
} as const;

type Access = z.infer<typeof accessSchema>;
type LoadState = 'error' | 'idle' | 'loading';
type Organization = z.infer<typeof organizationsSchema>[number];

export default function DatasetsPage() {
  const { t } = useTranslation();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [organizationId, setOrganizationId] = useState('');
  const [access, setAccess] = useState<Access>();
  const [datasets, setDatasets] = useState<DatasetSummary[]>([]);
  const [openDataset, setOpenDataset] = useState<DatasetSummary>();
  const [reloads, setReloads] = useState(0);
  // One status per request, so a success can never repaint another request's failure as healthy.
  const [organizationsState, setOrganizationsState] =
    useState<LoadState>('loading');
  const [accessState, setAccessState] = useState<LoadState>('loading');
  const [datasetsState, setDatasetsState] = useState<LoadState>('loading');
  const [file, setFile] = useState<File>();
  const [uploadState, setUploadState] = useState<
    'accepted' | 'error' | 'idle' | 'uploading'
  >('idle');

  useEffect(() => {
    const controller = new AbortController();
    void getJson('/api/auth/organization/list', controller.signal)
      .then((payload) => organizationsSchema.parse(payload))
      .then((items) => {
        setOrganizations(items);
        setOrganizationId(items[0]?.id ?? '');
        setOrganizationsState('idle');
      })
      .catch((error: unknown) => {
        if (!isAbortError(error)) {
          setOrganizationsState('error');
        }
      });
    return () => {
      controller.abort();
    };
  }, []);

  useEffect(() => {
    if (organizationId.length === 0) {
      return;
    }

    const controller = new AbortController();
    void getJson(
      `/api/bff/application/organizations/${encodeURIComponent(organizationId)}/access`,
      controller.signal,
    )
      .then((payload) => accessSchema.parse(payload))
      .then((contract) => {
        if (contract.organizationId !== organizationId) {
          throw new Error('Organization mismatch.');
        }

        setAccess(contract);
        setAccessState('idle');
      })
      .catch((error: unknown) => {
        if (!isAbortError(error)) {
          setAccess(undefined);
          setAccessState('error');
        }
      });
    return () => {
      controller.abort();
    };
  }, [organizationId]);

  useEffect(() => {
    if (organizationId.length === 0) {
      return;
    }

    const controller = new AbortController();
    void getJson(datasetsPath(organizationId), controller.signal)
      .then((payload) => datasetListSchema.parse(payload))
      .then((list) => {
        setDatasets(list.datasets);
        setDatasetsState('idle');
      })
      .catch((error: unknown) => {
        if (!isAbortError(error)) {
          setDatasets([]);
          setDatasetsState('error');
        }
      });
    return () => {
      controller.abort();
    };
  }, [organizationId, reloads]);

  function selectOrganization(id: string): void {
    setAccess(undefined);
    setAccessState('loading');
    setDatasets([]);
    setDatasetsState('loading');
    setFile(undefined);
    setOpenDataset(undefined);
    setOrganizationId(id);
    setUploadState('idle');
  }

  async function upload(): Promise<void> {
    if (file === undefined) {
      return;
    }

    setUploadState('uploading');
    const body = new FormData();
    body.append('file', file);

    try {
      const response = await fetch(uploadsPath(organizationId), {
        body,
        cache: 'no-store',
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error('Upload rejected.');
      }

      setUploadState('accepted');
      // Ingestion is asynchronous, so the list is asked again rather than guessed at.
      setReloads((previous) => previous + 1);
    } catch {
      setUploadState('error');
    }
  }

  // Access and the list are resolved separately, so each failure is reported on its own terms.
  const resolving =
    organizationsState === 'loading' ||
    (organizationId.length > 0 &&
      (accessState === 'loading' || datasetsState === 'loading'));
  const listFailed =
    organizationsState === 'error' || datasetsState === 'error';
  const accessFailed = accessState === 'error';
  const empty =
    !resolving && !listFailed && !accessFailed && datasets.length === 0;

  return (
    <main>
      <Stack gap={7}>
        <h1>{t('datasets.title')}</h1>
        {resolving ? (
          <InlineLoading description={t('datasets.loading')} />
        ) : null}
        {accessFailed ? (
          <InlineNotification
            kind="error"
            lowContrast
            title={t('datasets.accessError')}
          />
        ) : null}
        {listFailed ? (
          <InlineNotification
            kind="error"
            lowContrast
            title={t('datasets.error')}
          />
        ) : null}
        {organizations.length > 0 ? (
          <Select
            id="datasets-organization"
            labelText={t('datasets.organization')}
            onChange={(event) => {
              selectOrganization(event.target.value);
            }}
            value={organizationId}
          >
            {organizations.map((organization) => (
              <SelectItem
                key={organization.id}
                text={organization.name}
                value={organization.id}
              />
            ))}
          </Select>
        ) : null}
        {empty ? (
          <InlineNotification
            kind="info"
            lowContrast
            title={t('datasets.empty')}
          />
        ) : null}
        {datasets.length > 0 ? (
          <TableContainer
            description={t('datasets.listDescription')}
            title={t('datasets.listTitle')}
          >
            <Table aria-label={t('datasets.listTitle')} size="sm">
              <TableHead>
                <TableRow>
                  <TableHeader scope="col">
                    {t('datasets.columnName')}
                  </TableHeader>
                  <TableHeader scope="col">
                    {t('datasets.columnStatus')}
                  </TableHeader>
                  <TableHeader scope="col">
                    {t('datasets.columnRows')}
                  </TableHeader>
                  <TableHeader scope="col">
                    {t('datasets.columnUpdated')}
                  </TableHeader>
                  <TableHeader scope="col">
                    {t('datasets.columnAction')}
                  </TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {datasets.map((dataset) => (
                  <TableRow key={dataset.id}>
                    <TableCell>{dataset.name}</TableCell>
                    <TableCell>{t(statusLabels[dataset.status])}</TableCell>
                    <TableCell>{dataset.rowCount}</TableCell>
                    <TableCell>{dataset.updatedAt.slice(0, 10)}</TableCell>
                    <TableCell>
                      <Button
                        aria-label={t('datasets.openNamed', {
                          name: dataset.name,
                        })}
                        kind="ghost"
                        onClick={() => {
                          setOpenDataset(dataset);
                        }}
                        size="sm"
                        type="button"
                      >
                        {t('datasets.open')}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        ) : null}
        {/* Capabilities only choose which actions are offered, the database enforces access. */}
        {access?.capabilities.uploadData ? (
          <Stack gap={5}>
            <h2>{t('datasets.uploadTitle')}</h2>
            <FileUploader
              accept={['.csv', '.xlsx']}
              buttonKind="tertiary"
              buttonLabel={t('datasets.uploadChoose')}
              filenameStatus="edit"
              iconDescription={t('datasets.uploadClear')}
              labelDescription={t('datasets.uploadDescription')}
              labelTitle={t('datasets.uploadTitle')}
              name="file"
              onAddFiles={(_event, content) => {
                setFile(content.addedFiles[0]);
                setUploadState('idle');
              }}
              onDelete={() => {
                setFile(undefined);
              }}
            />
            <Button
              disabled={file === undefined || uploadState === 'uploading'}
              onClick={() => void upload()}
              type="button"
            >
              {t('datasets.uploadSubmit')}
            </Button>
            {uploadState === 'uploading' ? (
              <InlineLoading description={t('datasets.uploadWaiting')} />
            ) : null}
            {uploadState === 'accepted' ? (
              <InlineNotification
                kind="success"
                lowContrast
                title={t('datasets.uploadAccepted')}
              />
            ) : null}
            {uploadState === 'error' ? (
              <InlineNotification
                kind="error"
                lowContrast
                title={t('datasets.uploadFailed')}
              />
            ) : null}
          </Stack>
        ) : null}
        {openDataset !== undefined && access !== undefined ? (
          <DatasetView
            dataset={openDataset}
            // Keyed by dataset, so a newly opened one never inherits the cursor, rows or chat of the last.
            key={openDataset.id}
            onClose={() => {
              setOpenDataset(undefined);
            }}
            organizationId={organizationId}
            useAi={access.capabilities.useAi}
          />
        ) : null}
      </Stack>
    </main>
  );
}
