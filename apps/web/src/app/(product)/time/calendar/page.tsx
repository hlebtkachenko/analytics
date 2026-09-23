'use client';

import { useTranslation } from 'react-i18next';

import { TeamTimePage } from '../team-time-page';
import PageContainer from '../../../../components/page-container';

export default function CalendarPage() {
  const { t } = useTranslation();
  return (
    <PageContainer>
      <TeamTimePage mode="calendar" title={t('time.calendar')} />
    </PageContainer>
  );
}
