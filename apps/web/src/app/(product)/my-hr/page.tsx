'use client';
import { InlineNotification, Link, Stack } from '@bap/design-system/react';
import { DataGrid } from '@bap/design-system/blocks';
import NextLink from 'next/link';
import { useTranslation } from 'react-i18next';
import PageContainer from '../../../components/page-container';
import { useMyHr } from './my-hr-state';
export default function MyHrPage() {
  const { t } = useTranslation();
  const { organization, profile, state } = useMyHr();
  return (
    <PageContainer>
      <Stack gap={6}>
        {organization.state === 'error' || state === 'error' ? (
          <InlineNotification
            kind="error"
            title={t('myHr.accessError')}
            hideCloseButton
          />
        ) : state === 'unavailable' ? (
          <InlineNotification
            kind="warning"
            title={t('myHr.revoked')}
            hideCloseButton
          />
        ) : organization.state === 'loading' || state === 'loading' ? (
          <InlineNotification
            kind="info"
            title={t('myHr.loading')}
            hideCloseButton
          />
        ) : profile ? (
          <>
            <h1>{t('myHr.title')}</h1>
            <DataGrid
              columns={[
                { key: 'employeeNumber', header: t('myHr.employeeNumber') },
                { key: 'firstName', header: t('myHr.firstName') },
                { key: 'lastName', header: t('myHr.lastName') },
                { key: 'workEmail', header: t('myHr.workEmail') },
                { key: 'workPhone', header: t('myHr.workPhone') },
                { key: 'status', header: t('myHr.status') },
              ]}
              rows={[profile.employee]}
              state="ready"
              emptyLabel={t('myHr.empty')}
              errorLabel={t('myHr.error')}
            />
            <DataGrid
              columns={[
                { key: 'kind', header: t('myHr.relationship') },
                { key: 'position', header: t('myHr.position') },
                { key: 'department', header: t('myHr.department') },
                { key: 'costCentre', header: t('myHr.costCentre') },
                { key: 'weeklyHours', header: t('myHr.time') },
                { key: 'startDate', header: t('myHr.periodStart') },
                { key: 'endDate', header: t('myHr.periodEnd') },
              ]}
              rows={profile.relationships}
              state={profile.relationships.length ? 'ready' : 'empty'}
              emptyLabel={t('myHr.empty')}
              errorLabel={t('myHr.error')}
            />
            <Link as={NextLink} href="/my-hr/documents">
              {t('myHr.documents')}
            </Link>
            <Link as={NextLink} href="/my-hr/payslips">
              {t('myHr.payslips')}
            </Link>
            <Link as={NextLink} href="/my-hr/time">
              {t('myHr.time')}
            </Link>
            <Link as={NextLink} href="/my-hr/leave">
              {t('myHr.leave')}
            </Link>
          </>
        ) : null}
      </Stack>
    </PageContainer>
  );
}
