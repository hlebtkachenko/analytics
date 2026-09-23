'use client';

import { DataGrid } from '@bap/design-system/blocks';
import {
  Button,
  Heading,
  InlineNotification,
  Modal,
  Select,
  SelectItem,
  Stack,
  TextInput,
  Toggle,
} from '@bap/design-system/react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import PageContainer from '../../../../components/page-container';
import { getJson } from '../../../../lib/datasets/client';
import {
  payrollAccountMappingsPath,
  payrollAccountMappingPath,
  payrollComponentPath,
  payrollComponentsPath,
  sendHrJson,
} from '../../../../lib/hr/client';
import {
  payrollAccountMappingListSchema,
  payrollComponentListSchema,
  createPayrollAccountMappingSchema,
  createPayrollComponentSchema,
  payrollAccountMappingSchema,
  payrollComponentSchema,
  updatePayrollAccountMappingSchema,
  updatePayrollComponentSchema,
} from '../../../../lib/hr/contract';
import { useOrganizationAccess } from '../../../../lib/organizations/use-organization-access';
import { useOrganizationSelection } from '../../../../lib/organizations/use-organization-selection';
import { SettingsNavigation } from '../settings-navigation';

export default function PayrollSettingsPage() {
  const { t } = useTranslation();
  const organization = useOrganizationSelection();
  const { access, state: accessState } = useOrganizationAccess(
    organization.organizationId,
  );
  const [components, setComponents] = useState<
    (typeof payrollComponentListSchema._output)['components']
  >([]);
  const [mappings, setMappings] = useState<
    (typeof payrollAccountMappingListSchema._output)['mappings']
  >([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadedFor, setLoadedFor] = useState('');
  const [reload, setReload] = useState(0);
  const [modal, setModal] = useState<'component' | 'mapping' | null>(null);
  const [editing, setEditing] = useState<{
    id: string;
    type: 'component' | 'mapping';
  } | null>(null);
  const [form, setForm] = useState({
    legalEntityId: '',
    code: '',
    name: '',
    kind: 'earning',
    recurrence: 'recurring',
    accountingKey: '',
    active: true,
    accountCode: '',
    side: 'debit',
    validFrom: '',
    validTo: '',
  });
  const [mutationError, setMutationError] = useState(false);
  useEffect(() => {
    if (!organization.organizationId || !access?.capabilities.readPayroll)
      return;
    const controller = new AbortController();
    void Promise.all([
      getJson(
        payrollComponentsPath(
          organization.organizationId,
          new URLSearchParams({ page: '1', pageSize: '25' }),
        ),
        controller.signal,
      ).then((x) => payrollComponentListSchema.parse(x)),
      getJson(
        payrollAccountMappingsPath(
          organization.organizationId,
          new URLSearchParams({ page: '1', pageSize: '25' }),
        ),
        controller.signal,
      ).then((x) => payrollAccountMappingListSchema.parse(x)),
    ])
      .then(([c, m]) => {
        if (controller.signal.aborted) return;
        setComponents(c.components);
        setMappings(m.mappings);
        setState('ready');
        setLoadedFor(organization.organizationId);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setLoadedFor(organization.organizationId);
          setState('error');
        }
      });
    return () => controller.abort();
  }, [access?.capabilities.readPayroll, organization.organizationId, reload]);
  const close = () => {
    setModal(null);
    setEditing(null);
    setMutationError(false);
    setForm({
      legalEntityId: '',
      code: '',
      name: '',
      kind: 'earning',
      recurrence: 'recurring',
      accountingKey: '',
      active: true,
      accountCode: '',
      side: 'debit',
      validFrom: '',
      validTo: '',
    });
  };
  const save = async () => {
    if (!organization.organizationId || !modal) return;
    const component = modal === 'component';
    const schema = component
      ? editing
        ? updatePayrollComponentSchema
        : createPayrollComponentSchema
      : editing
        ? updatePayrollAccountMappingSchema
        : createPayrollAccountMappingSchema;
    const raw = component
      ? editing
        ? { name: form.name, active: form.active }
        : {
            legalEntityId: form.legalEntityId,
            code: form.code,
            name: form.name,
            kind: form.kind,
            recurrence: form.recurrence,
            accountingKey: form.accountingKey,
          }
      : editing
        ? {
            accountCode: form.accountCode,
            side: form.side,
            validFrom: form.validFrom,
            validTo: form.validTo || null,
          }
        : {
            legalEntityId: form.legalEntityId,
            accountingKey: form.accountingKey,
            accountCode: form.accountCode,
            side: form.side,
            validFrom: form.validFrom,
            validTo: form.validTo || null,
          };
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      setMutationError(true);
      return;
    }
    try {
      await sendHrJson(
        editing
          ? component
            ? payrollComponentPath(organization.organizationId, editing.id)
            : payrollAccountMappingPath(organization.organizationId, editing.id)
          : component
            ? payrollComponentsPath(organization.organizationId)
            : payrollAccountMappingsPath(organization.organizationId),
        editing ? 'PATCH' : 'POST',
        parsed.data,
        (component
          ? payrollComponentSchema
          : payrollAccountMappingSchema) as never,
      );
      close();
      setReload((value) => value + 1);
    } catch {
      setMutationError(true);
    }
  };
  const gridState =
    loadedFor !== organization.organizationId
      ? 'loading'
      : state === 'loading'
        ? 'loading'
        : state === 'error'
          ? 'error'
          : 'ready';
  return (
    <PageContainer>
      <Stack gap={5}>
        <SettingsNavigation />
        <Heading>{t('hrSettings.payroll')}</Heading>
        {accessState !== 'idle' ? (
          <InlineNotification
            kind="error"
            title={t('hrSettings.accessError')}
            hideCloseButton
          />
        ) : !access?.capabilities.readPayroll ? (
          <InlineNotification
            kind="error"
            title={t('hrSettings.denied')}
            hideCloseButton
          />
        ) : (
          <>
            <Heading>{t('hrSettings.payrollComponents')}</Heading>
            {access.capabilities.managePayroll ? (
              <Button onClick={() => setModal('component')}>
                {t('hrSettings.create')}
              </Button>
            ) : null}
            <DataGrid
              state={
                components.length === 0 && gridState === 'ready'
                  ? 'empty'
                  : gridState
              }
              emptyLabel={t('hrSettings.payrollEmpty')}
              errorLabel={t('hrSettings.payrollError')}
              columns={[
                { key: 'code', header: t('hrSettings.code') },
                { key: 'name', header: t('hrSettings.name') },
                { key: 'active', header: t('hrSettings.active') },
              ]}
              rows={components}
              rowActions={(row) =>
                access.capabilities.managePayroll
                  ? [
                      {
                        id: 'edit',
                        label: t('hrSettings.edit'),
                        onClick: () => {
                          const item = components.find(
                            (value) => value.id === row.id,
                          );
                          if (!item) return;
                          setEditing({ id: item.id, type: 'component' });
                          setForm({
                            legalEntityId: item.legalEntityId,
                            code: item.code,
                            name: item.name,
                            kind: item.kind,
                            recurrence: item.recurrence,
                            accountingKey: item.accountingKey,
                            active: item.active,
                            accountCode: '',
                            side: 'debit',
                            validFrom: '',
                            validTo: '',
                          });
                          setModal('component');
                        },
                      },
                    ]
                  : []
              }
            />
            <Heading>{t('hrSettings.payrollMappings')}</Heading>
            {access.capabilities.managePayroll ? (
              <Button onClick={() => setModal('mapping')}>
                {t('hrSettings.create')}
              </Button>
            ) : null}
            <DataGrid
              state={
                mappings.length === 0 && gridState === 'ready'
                  ? 'empty'
                  : gridState
              }
              emptyLabel={t('hrSettings.payrollEmpty')}
              errorLabel={t('hrSettings.payrollError')}
              columns={[
                { key: 'accountingKey', header: t('hrSettings.code') },
                { key: 'accountCode', header: t('hrSettings.details') },
                { key: 'validFrom', header: t('employees.effectiveFrom') },
              ]}
              rows={mappings}
              rowActions={(row) =>
                access.capabilities.managePayroll
                  ? [
                      {
                        id: 'version',
                        label: t('employees.compensationVersion'),
                        onClick: () => {
                          const item = mappings.find(
                            (value) => value.id === row.id,
                          );
                          if (!item) return;
                          setEditing({ id: item.id, type: 'mapping' });
                          setForm({
                            legalEntityId: item.legalEntityId,
                            code: '',
                            name: '',
                            kind: 'earning',
                            recurrence: 'recurring',
                            accountingKey: item.accountingKey,
                            active: true,
                            accountCode: item.accountCode,
                            side: item.side,
                            validFrom: item.validFrom,
                            validTo: item.validTo ?? '',
                          });
                          setModal('mapping');
                        },
                      },
                    ]
                  : []
              }
            />
          </>
        )}
        <Modal
          open={modal !== null}
          modalHeading={t(
            modal === 'component'
              ? 'hrSettings.payrollComponents'
              : 'hrSettings.payrollMappings',
          )}
          primaryButtonText={t('hrSettings.save')}
          secondaryButtonText={t('hrSettings.cancel')}
          onRequestClose={close}
          onRequestSubmit={() => void save()}
        >
          <Stack gap={5}>
            {mutationError ? (
              <InlineNotification
                kind="error"
                title={t('hrSettings.saveFailed')}
                hideCloseButton
              />
            ) : null}
            {modal === 'component' ? (
              <>
                <TextInput
                  id="name"
                  labelText={t('hrSettings.name')}
                  value={form.name}
                  onChange={(event) =>
                    setForm({ ...form, name: event.target.value })
                  }
                />
                {!editing ? (
                  <>
                    <TextInput
                      id="legalEntityId"
                      labelText={t('hrSettings.legalEntity')}
                      value={form.legalEntityId}
                      onChange={(event) =>
                        setForm({ ...form, legalEntityId: event.target.value })
                      }
                    />
                    <TextInput
                      id="code"
                      labelText={t('hrSettings.code')}
                      value={form.code}
                      onChange={(event) =>
                        setForm({ ...form, code: event.target.value })
                      }
                    />
                    <TextInput
                      id="accountingKey"
                      labelText={t('hrSettings.details')}
                      value={form.accountingKey}
                      onChange={(event) =>
                        setForm({ ...form, accountingKey: event.target.value })
                      }
                    />
                    <Select
                      id="kind"
                      labelText={t('hrSettings.kind')}
                      value={form.kind}
                      onChange={(event) =>
                        setForm({ ...form, kind: event.target.value })
                      }
                    >
                      <SelectItem value="earning" text="earning" />
                      <SelectItem value="deduction" text="deduction" />
                      <SelectItem
                        value="employer_contribution"
                        text="employer contribution"
                      />
                    </Select>
                    <Select
                      id="recurrence"
                      labelText={t('hrSettings.status')}
                      value={form.recurrence}
                      onChange={(event) =>
                        setForm({ ...form, recurrence: event.target.value })
                      }
                    >
                      <SelectItem value="recurring" text="recurring" />
                      <SelectItem value="one_off" text="one off" />
                    </Select>
                  </>
                ) : null}
                <Toggle
                  id="active"
                  labelText={t('hrSettings.active')}
                  toggled={form.active}
                  onToggle={(active) => setForm({ ...form, active })}
                />
              </>
            ) : (
              <>
                <TextInput
                  id="legalEntityId"
                  labelText={t('hrSettings.legalEntity')}
                  value={form.legalEntityId}
                  disabled={Boolean(editing)}
                  onChange={(event) =>
                    setForm({ ...form, legalEntityId: event.target.value })
                  }
                />
                <TextInput
                  id="accountingKey"
                  labelText={t('hrSettings.details')}
                  value={form.accountingKey}
                  disabled={Boolean(editing)}
                  onChange={(event) =>
                    setForm({ ...form, accountingKey: event.target.value })
                  }
                />
                <TextInput
                  id="accountCode"
                  labelText={t('hrSettings.code')}
                  value={form.accountCode}
                  onChange={(event) =>
                    setForm({ ...form, accountCode: event.target.value })
                  }
                />
                <Select
                  id="side"
                  labelText={t('hrSettings.status')}
                  value={form.side}
                  onChange={(event) =>
                    setForm({ ...form, side: event.target.value })
                  }
                >
                  <SelectItem value="debit" text="debit" />
                  <SelectItem value="credit" text="credit" />
                </Select>
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
              </>
            )}
          </Stack>
        </Modal>
      </Stack>
    </PageContainer>
  );
}
