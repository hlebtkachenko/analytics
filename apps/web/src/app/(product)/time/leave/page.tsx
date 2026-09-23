'use client';

import { useTranslation } from 'react-i18next';

import { TeamTimePage } from '../team-time-page';
import PageContainer from '../../../../components/page-container';

export default function LeavePage() {
  const { t } = useTranslation();
  return (
    <PageContainer>
      <TeamTimePage mode="leave" title={t('time.leave')} />
    </PageContainer>
  );
}
