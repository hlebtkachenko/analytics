'use client';

import { useParams } from 'next/navigation';
import { useTranslation } from 'react-i18next';

import { LeaveRecordsPage } from '../../../time/leave-records-page';
import PageContainer from '../../../../../components/page-container';
import { EmployeeTabs } from '../employee-tabs';

export default function EmployeeLeavePage() {
  const { employeeId } = useParams<{ employeeId: string }>();
  const { t } = useTranslation();
  return (
    <PageContainer>
      <LeaveRecordsPage
        employeeId={employeeId}
        title={t('employees.leave')}
        tabs={<EmployeeTabs />}
      />
    </PageContainer>
  );
}
