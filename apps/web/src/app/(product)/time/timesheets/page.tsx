'use client';

import { useTranslation } from 'react-i18next';

import { TeamTimePage } from '../team-time-page';
import PageContainer from '../../../../components/page-container';

export default function TimesheetsPage() {
  const { t } = useTranslation();
  return (
    <PageContainer>
      <TeamTimePage mode="timesheets" title={t('time.timesheets')} />
    </PageContainer>
  );
}
