'use client';

import {
  Button,
  FileUploader,
  Form,
  InlineNotification,
  Select,
  SelectItem,
  Stack,
  TextInput,
} from '@bap/design-system/react';
import { DataGrid } from '@bap/design-system/blocks';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import PageContainer from '../../../../components/page-container';
import { getJson } from '../../../../lib/datasets/client';
import {
  payrollImportConsumePath,
  payrollImportPath,
  payrollImportsPath,
  isValidPayrollImportInput,
  postPayrollImport,
  postPayrollImportConsume,
} from '../../../../lib/payroll/client';
import {
  payrollImportConsumeResponseSchema,
  payrollImportResponseSchema,
  payrollImportSchema,
} from '../../../../lib/payroll/contract';
import { useLegalEntities } from '../../../../lib/organizations/use-legal-entities';
import { useOrganizationAccess } from '../../../../lib/organizations/use-organization-access';
import { useOrganizationSelection } from '../../../../lib/organizations/use-organization-selection';

export default function PayrollImportPage() {
  const { t } = useTranslation();
  const organization = useOrganizationSelection();
  const { access } = useOrganizationAccess(organization.organizationId);
  const entities = useLegalEntities(organization.organizationId);
  const [entityId, setEntityId] = useState('');
  const [file, setFile] = useState<File>();
  const [importState, setImportState] = useState<{
    data: typeof payrollImportSchema._output;
    organizationId: string;
  }>();
  const [state, setState] = useState<
    'idle' | 'uploading' | 'error' | 'consuming'
  >('idle');
  const organizationKey = useRef(organization.organizationId);

  useEffect(() => {
    organizationKey.current = organization.organizationId;
  }, [organization.organizationId]);

  const currentImport =
    importState?.organizationId === organization.organizationId
      ? importState.data
      : undefined;

  useEffect(() => {
    if (!currentImport || currentImport.status !== 'staged') return;
    const controller = new AbortController();
    const refresh = async () => {
      try {
        const response = payrollImportResponseSchema.parse(
          await getJson(
            payrollImportPath(organization.organizationId, currentImport.id),
            controller.signal,
          ),
        );
        if (
          !controller.signal.aborted &&
          organizationKey.current === organization.organizationId
        ) {
          setImportState({
            data: response.payrollImport,
            organizationId: organization.organizationId,
          });
        }
      } catch {
        if (
          !controller.signal.aborted &&
          organizationKey.current === organization.organizationId
        )
          setState('error');
      }
    };
    const timer = window.setInterval(() => void refresh(), 1_000);
    void refresh();
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [currentImport, organization.organizationId]);

  if (access === undefined) {
    return (
      <PageContainer>
        <InlineNotification
          kind="info"
          title={t('payrollImport.loading')}
          hideCloseButton
        />
      </PageContainer>
    );
  }
  const canRead = access.capabilities.readPayroll;
  const canManage = access.capabilities.managePayroll;
  if (!canRead) {
    return (
      <PageContainer>
        <InlineNotification
          kind="error"
          title={t('payrollImport.denied')}
          hideCloseButton
        />
      </PageContainer>
    );
  }

  const invalidFile =
    file !== undefined &&
    !isValidPayrollImportInput(file, entityId || 'entity', '2026-01-01');
  const reset = () => {
    setFile(undefined);
    setImportState(undefined);
    setState('idle');
  };
  return (
    <PageContainer>
      <Stack gap={5}>
        {!canManage && (
          <InlineNotification
            kind="error"
            title={t('payrollImport.manageDenied')}
            hideCloseButton
          />
        )}
        {state === 'error' && (
          <InlineNotification
            kind="error"
            title={t('payrollImport.error')}
            hideCloseButton
          />
        )}
        {!currentImport && canManage && (
          <Form
            onSubmit={(event) => {
              event.preventDefault();
              const month = `${String(new FormData(event.currentTarget).get('payrollMonth'))}-01`;
              if (!file || !isValidPayrollImportInput(file, entityId, month)) {
                setState('error');
                return;
              }
              const data = new FormData();
              data.set('file', file, file.name);
              data.set('legalEntityId', entityId);
              data.set('payrollMonth', month);
              setState('uploading');
              void postPayrollImport(
                payrollImportsPath(organization.organizationId),
                data,
                payrollImportResponseSchema,
              )
                .then((response) => {
                  if (organizationKey.current !== organization.organizationId)
                    return;
                  setImportState({
                    data: response.payrollImport,
                    organizationId: organization.organizationId,
                  });
                  setFile(undefined);
                  setState('idle');
                })
                .catch(() => {
                  if (organizationKey.current === organization.organizationId)
                    setState('error');
                });
            }}
          >
            <Stack gap={5}>
              <Select
                id="legalEntityId"
                labelText={t('payrollImport.legalEntity')}
                value={entityId}
                onChange={(event) => setEntityId(event.target.value)}
                required
              >
                <SelectItem
                  value=""
                  text={t('payrollImport.selectLegalEntity')}
                />
                {entities.map((entity) => (
                  <SelectItem
                    key={entity.id}
                    value={entity.id}
                    text={entity.name}
                  />
                ))}
              </Select>
              <TextInput
                id="payrollMonth"
                name="payrollMonth"
                type="month"
                labelText={t('payrollImport.month')}
                required
              />
              <FileUploader
                id="file"
                labelTitle={t('payrollImport.file')}
                labelDescription={t('payrollImport.fileDescription')}
                accept={['.csv', '.xlsx']}
                filenameStatus="edit"
                name="file"
                onAddFiles={(_event, content) => setFile(content.addedFiles[0])}
                onDelete={() => setFile(undefined)}
              />
              {invalidFile && (
                <InlineNotification
                  kind="error"
                  title={t('payrollImport.invalidFile')}
                  hideCloseButton
                />
              )}
              <Button type="submit" disabled={state === 'uploading'}>
                {state === 'uploading'
                  ? t('payrollImport.uploading')
                  : t('payrollImport.upload')}
              </Button>
            </Stack>
          </Form>
        )}
        {currentImport && (
          <Stack gap={5}>
            <InlineNotification
              kind={currentImport.status === 'failed' ? 'error' : 'success'}
              title={t(`payrollImport.status.${currentImport.status}`)}
              hideCloseButton
            />
            {currentImport.status === 'failed' && (
              <>
                <DataGrid
                  columns={[
                    { key: 'row', header: t('payrollImport.row') },
                    { key: 'field', header: t('payrollImport.field') },
                    { key: 'code', header: t('payrollImport.code') },
                  ]}
                  rows={currentImport.errorReport.map((error) => ({
                    ...error,
                    id: `${error.row}-${error.field}-${error.code}`,
                  }))}
                  state={
                    currentImport.errorReport.length === 0 ? 'empty' : 'ready'
                  }
                  emptyLabel={t('payrollImport.errorsEmpty')}
                />
                <Button onClick={reset}>{t('payrollImport.newImport')}</Button>
              </>
            )}
            {currentImport.status === 'validated' && canManage && (
              <Button
                disabled={state === 'consuming'}
                onClick={() => {
                  setState('consuming');
                  void postPayrollImportConsume(
                    payrollImportConsumePath(
                      organization.organizationId,
                      currentImport.id,
                    ),
                    payrollImportConsumeResponseSchema,
                  )
                    .then((response) => {
                      if (
                        organizationKey.current === organization.organizationId
                      )
                        setImportState({
                          data: {
                            ...currentImport,
                            payrollRunId: response.payrollRunId,
                            status: 'consumed',
                          },
                          organizationId: organization.organizationId,
                        });
                    })
                    .catch(() => {
                      if (
                        organizationKey.current === organization.organizationId
                      )
                        setState('error');
                    });
                }}
              >
                {state === 'consuming'
                  ? t('payrollImport.consuming')
                  : t('payrollImport.consume')}
              </Button>
            )}
            {currentImport.status === 'consumed' && (
              <>
                <TextInput
                  id="payrollRunId"
                  labelText={t('payrollImport.payrollRunId')}
                  value={currentImport.payrollRunId ?? ''}
                  readOnly
                />
                <Button onClick={reset}>{t('payrollImport.newImport')}</Button>
              </>
            )}
          </Stack>
        )}
      </Stack>
    </PageContainer>
  );
}
