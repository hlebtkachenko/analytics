'use client';

import { DataGrid } from '@bap/design-system/blocks';
import {
  Button,
  Heading,
  InlineNotification,
  Select,
  SelectItem,
  Stack,
  TextInput,
} from '@bap/design-system/react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import PageContainer from '../../../../components/page-container';
import { getJson } from '../../../../lib/datasets/client';
import {
  hrAccessAssignmentPath,
  hrAccessAssignmentsPath,
} from '../../../../lib/hr/client';
import {
  createHrAccessAssignmentSchema,
  hrAccessAssignmentListSchema,
  type HrAccessAssignment,
} from '../../../../lib/hr/contract';
import { useOrganizationAccess } from '../../../../lib/organizations/use-organization-access';
import { useOrganizationSelection } from '../../../../lib/organizations/use-organization-selection';
import { SettingsNavigation } from '../settings-navigation';

type ListState = Readonly<{
  assignments: HrAccessAssignment[];
  organizationId: string;
  status: 'error' | 'loading' | 'ready';
}>;

type MutationError = 'create' | 'revoke' | null;

const accessRoles = [
  'hr_admin',
  'payroll_specialist',
  'payroll_approver',
  'sensitive_hr',
  'hr_auditor',
] as const;

function roleLabelKey(role: (typeof accessRoles)[number]) {
  return `hrSettings.accessRole${role
    .split('_')
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join('')}`;
}

export default function HrAccessAssignmentsPage() {
  const { t } = useTranslation();
  const organization = useOrganizationSelection();
  const { access, state: accessState } = useOrganizationAccess(
    organization.organizationId,
  );
  const [list, setList] = useState<ListState>({
    assignments: [],
    organizationId: '',
    status: 'loading',
  });
  const [reload, setReload] = useState(0);
  const [mutationError, setMutationError] = useState<MutationError>(null);
  const [userId, setUserId] = useState('');
  const [legalEntityId, setLegalEntityId] = useState('');
  const [accessRole, setAccessRole] =
    useState<(typeof accessRoles)[number]>('hr_admin');
  const owner = access?.capabilities?.manageOrganization === true;

  useEffect(() => {
    const organizationId = organization.organizationId;
    if (accessState !== 'idle' || !owner || organizationId.length === 0) return;

    const controller = new AbortController();
    void getJson(hrAccessAssignmentsPath(organizationId), controller.signal)
      .then((value) => hrAccessAssignmentListSchema.parse(value))
      .then((value) => {
        if (!controller.signal.aborted) {
          setList({
            assignments: value.assignments,
            organizationId,
            status: 'ready',
          });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setList({ assignments: [], organizationId, status: 'error' });
        }
      });
    return () => controller.abort();
  }, [accessState, organization.organizationId, owner, reload]);

  const create = async () => {
    const body = createHrAccessAssignmentSchema.safeParse({
      accessRole,
      legalEntityId,
      userId,
    });
    if (!body.success || !organization.organizationId) {
      setMutationError('create');
      return;
    }
    try {
      const response = await fetch(
        hrAccessAssignmentsPath(organization.organizationId),
        {
          body: JSON.stringify(body.data),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        },
      );
      if (!response.ok) throw new Error('Create rejected.');
      setMutationError(null);
      setUserId('');
      setLegalEntityId('');
      setReload((value) => value + 1);
    } catch {
      setMutationError('create');
    }
  };

  const revoke = async (assignmentId: string) => {
    if (!organization.organizationId) return;
    try {
      const response = await fetch(
        hrAccessAssignmentPath(organization.organizationId, assignmentId),
        { method: 'DELETE' },
      );
      if (!response.ok) throw new Error('Revoke rejected.');
      setMutationError(null);
      setReload((value) => value + 1);
    } catch {
      setMutationError('revoke');
    }
  };

  const currentList = list.organizationId === organization.organizationId;
  const gridState =
    !currentList || list.status === 'loading'
      ? 'loading'
      : list.status === 'error'
        ? 'error'
        : list.assignments.length === 0
          ? 'empty'
          : 'ready';

  return (
    <PageContainer>
      <Stack gap={5}>
        <SettingsNavigation />
        <Heading>{t('hrSettings.accessAssignments')}</Heading>
        {accessState === 'loading' && <p>{t('hrSettings.accessLoading')}</p>}
        {accessState === 'error' && (
          <InlineNotification
            kind="error"
            title={t('hrSettings.accessError')}
          />
        )}
        {accessState === 'idle' && !owner && (
          <InlineNotification
            kind="error"
            title={t('hrSettings.accessForbidden')}
          />
        )}
        {owner && (
          <DataGrid
            columns={[
              { key: 'userId', header: t('hrSettings.accessUserId') },
              { key: 'legalEntityId', header: t('hrSettings.legalEntity') },
              { key: 'accessRole', header: t('hrSettings.accessRole') },
            ]}
            emptyLabel={t('hrSettings.accessEmpty')}
            errorLabel={t('hrSettings.accessLoadError')}
            rows={
              currentList
                ? list.assignments.map((assignment) => ({
                    ...assignment,
                    accessRole: t(roleLabelKey(assignment.accessRole)),
                  }))
                : []
            }
            rowActions={(row) => [
              {
                id: 'revoke',
                isDelete: true,
                label: t('hrSettings.accessRevoke'),
                onClick: () => void revoke(row.id),
              },
            ]}
            state={gridState}
          />
        )}
        {owner && mutationError !== null && (
          <InlineNotification
            kind="error"
            title={t(
              mutationError === 'create'
                ? 'hrSettings.accessCreateError'
                : 'hrSettings.accessRevokeError',
            )}
          />
        )}
        {owner && (
          <>
            <TextInput
              id="access-user"
              labelText={t('hrSettings.accessUserId')}
              value={userId}
              onChange={(event) => setUserId(event.currentTarget.value)}
            />
            <TextInput
              id="access-entity"
              labelText={t('hrSettings.legalEntity')}
              value={legalEntityId}
              onChange={(event) => setLegalEntityId(event.currentTarget.value)}
            />
            <Select
              id="access-role"
              labelText={t('hrSettings.accessRole')}
              value={accessRole}
              onChange={(event) =>
                setAccessRole(
                  event.currentTarget.value as (typeof accessRoles)[number],
                )
              }
            >
              {accessRoles.map((role) => (
                <SelectItem
                  key={role}
                  text={t(roleLabelKey(role))}
                  value={role}
                />
              ))}
            </Select>
            <Button onClick={() => void create()}>
              {t('hrSettings.accessCreate')}
            </Button>
          </>
        )}
      </Stack>
    </PageContainer>
  );
}
