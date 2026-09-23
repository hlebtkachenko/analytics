'use client';

import { DataGrid } from '@bap/design-system/blocks';
import {
  Button,
  Heading,
  InlineNotification,
  Modal,
  Stack,
  TextInput,
} from '@bap/design-system/react';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import PageContainer from '../../../../../components/page-container';
import { getJson } from '../../../../../lib/datasets/client';
import {
  employeeCompensationComponentPath,
  employeeCompensationComponentsPath,
  sendHrJson,
} from '../../../../../lib/hr/client';
import {
  compensationComponentListSchema,
  compensationComponentSchema,
  createCompensationComponentSchema,
  updateCompensationComponentSchema,
} from '../../../../../lib/hr/contract';
import { useOrganizationAccess } from '../../../../../lib/organizations/use-organization-access';
import { useOrganizationSelection } from '../../../../../lib/organizations/use-organization-selection';
import { EmployeeTabs } from '../employee-tabs';

export default function CompensationPage() {
  const { t } = useTranslation();
  const { employeeId } = useParams<{ employeeId: string }>();
  const organization = useOrganizationSelection();
  const { access, state: accessState } = useOrganizationAccess(
    organization.organizationId,
  );
  const [items, setItems] = useState<
    (typeof compensationComponentListSchema._output)['compensationComponents']
  >([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadedFor, setLoadedFor] = useState('');
  const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(false);
  const [form, setForm] = useState({
    relationshipId: '',
    componentDefinitionId: '',
    validFrom: '',
    validTo: '',
    amount: '',
    currency: 'CZK',
  });
  useEffect(() => {
    if (!organization.organizationId || !access?.capabilities.readPayroll)
      return;
    const controller = new AbortController();
    void getJson(
      employeeCompensationComponentsPath(
        organization.organizationId,
        employeeId,
        new URLSearchParams({ page: '1', pageSize: '25' }),
      ),
      controller.signal,
    )
      .then((value) => compensationComponentListSchema.parse(value))
      .then((value) => {
        if (!controller.signal.aborted) {
          setItems(value.compensationComponents);
          setState('ready');
          setLoadedFor(`${organization.organizationId}:${employeeId}`);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setState('error');
      });
    return () => controller.abort();
  }, [
    access?.capabilities.readPayroll,
    employeeId,
    organization.organizationId,
    reload,
  ]);
  const gridState =
    state === 'loading'
      ? 'loading'
      : state === 'error'
        ? 'error'
        : loadedFor !== `${organization.organizationId}:${employeeId}` ||
            items.length === 0
          ? 'empty'
          : 'ready';
  return (
    <PageContainer>
      <Stack gap={5}>
        <EmployeeTabs />
        <Heading>{t('employees.compensation')}</Heading>
        {accessState !== 'idle' ? (
          <InlineNotification
            kind="error"
            title={t('employees.accessError')}
            hideCloseButton
          />
        ) : !access?.capabilities.readPayroll ? (
          <InlineNotification
            kind="error"
            title={t('employees.denied')}
            hideCloseButton
          />
        ) : (
          <>
            <>
              {access.capabilities.managePayroll ? (
                <Button
                  onClick={() => {
                    setEditing(null);
                    setOpen(true);
                    setError(false);
                  }}
                >
                  {t('hrSettings.create')}
                </Button>
              ) : null}
            </>
            <DataGrid
              state={gridState}
              emptyLabel={t('employees.compensationEmpty')}
              errorLabel={t('employees.compensationError')}
              columns={[
                { key: 'componentDefinitionId', header: t('hrSettings.code') },
                { key: 'amount', header: t('payroll.grossPay') },
                { key: 'currency', header: t('documents.currency') },
                { key: 'validFrom', header: t('employees.effectiveFrom') },
                { key: 'validTo', header: t('employees.effectiveTo') },
              ]}
              rows={items}
              rowActions={(row) =>
                access.capabilities.managePayroll
                  ? [
                      {
                        id: 'version',
                        label: t('employees.compensationVersion'),
                        onClick: () => {
                          const item = items.find(
                            (value) => value.id === row.id,
                          );
                          if (!item) return;
                          setEditing(item.id);
                          setForm({
                            relationshipId: item.relationshipId,
                            componentDefinitionId: item.componentDefinitionId,
                            validFrom: item.validFrom,
                            validTo: item.validTo ?? '',
                            amount: item.amount,
                            currency: item.currency,
                          });
                          setError(false);
                          setOpen(true);
                        },
                      },
                    ]
                  : []
              }
            />
            <Modal
              open={open}
              modalHeading={t(
                editing
                  ? 'employees.compensationVersion'
                  : 'employees.compensation',
              )}
              primaryButtonText={t('hrSettings.save')}
              secondaryButtonText={t('hrSettings.cancel')}
              onRequestClose={() => {
                setOpen(false);
                setError(false);
              }}
              onRequestSubmit={() =>
                void (async () => {
                  const schema = editing
                    ? updateCompensationComponentSchema
                    : createCompensationComponentSchema;
                  const body = editing
                    ? {
                        validFrom: form.validFrom,
                        validTo: form.validTo || null,
                        amount: form.amount,
                        currency: form.currency,
                      }
                    : { ...form, validTo: form.validTo || null };
                  const parsed = schema.safeParse(body);
                  if (!parsed.success || !organization.organizationId) {
                    setError(true);
                    return;
                  }
                  try {
                    await sendHrJson(
                      editing
                        ? employeeCompensationComponentPath(
                            organization.organizationId,
                            employeeId,
                            editing,
                          )
                        : employeeCompensationComponentsPath(
                            organization.organizationId,
                            employeeId,
                          ),
                      editing ? 'PATCH' : 'POST',
                      parsed.data,
                      compensationComponentSchema,
                    );
                    setOpen(false);
                    setError(false);
                    setForm({
                      relationshipId: '',
                      componentDefinitionId: '',
                      validFrom: '',
                      validTo: '',
                      amount: '',
                      currency: 'CZK',
                    });
                    setReload((value) => value + 1);
                  } catch {
                    setError(true);
                  }
                })()
              }
            >
              <Stack gap={5}>
                {error ? (
                  <InlineNotification
                    kind="error"
                    title={t('employees.compensationError')}
                    hideCloseButton
                  />
                ) : null}
                {!editing ? (
                  <>
                    <TextInput
                      id="relationshipId"
                      labelText={t('employees.relationship')}
                      value={form.relationshipId}
                      onChange={(event) =>
                        setForm({ ...form, relationshipId: event.target.value })
                      }
                    />
                    <TextInput
                      id="componentDefinitionId"
                      labelText={t('hrSettings.code')}
                      value={form.componentDefinitionId}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          componentDefinitionId: event.target.value,
                        })
                      }
                    />
                  </>
                ) : null}
                <TextInput
                  id="validFrom"
                  type="date"
                  labelText={t('employees.effectiveFrom')}
                  value={form.validFrom}
                  onChange={(event) =>
                    setForm({ ...form, validFrom: event.target.value })
                  }
                />
                <TextInput
                  id="validTo"
                  type="date"
                  labelText={t('employees.effectiveTo')}
                  value={form.validTo}
                  onChange={(event) =>
                    setForm({ ...form, validTo: event.target.value })
                  }
                />
                <TextInput
                  id="amount"
                  labelText={t('payroll.grossPay')}
                  value={form.amount}
                  onChange={(event) =>
                    setForm({ ...form, amount: event.target.value })
                  }
                />
                <TextInput
                  id="currency"
                  labelText={t('documents.currency')}
                  value={form.currency}
                  onChange={(event) =>
                    setForm({ ...form, currency: event.target.value })
                  }
                />
              </Stack>
            </Modal>
          </>
        )}
      </Stack>
    </PageContainer>
  );
}
