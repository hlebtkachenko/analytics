'use client';

import { useTranslation } from 'react-i18next';

import { TeamTimePage } from '../team-time-page';
import PageContainer from '../../../../components/page-container';

export default function ApprovalsPage() {
  const { t } = useTranslation();
  return (
    <PageContainer>
      <TeamTimePage mode="approvals" title={t('time.approvals')} />
    </PageContainer>
  );
}
