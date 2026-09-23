'use client';

import { useParams } from 'next/navigation';
import { useTranslation } from 'react-i18next';

import { TimeRecordsPage } from '../../../time/time-records-page';
import PageContainer from '../../../../../components/page-container';
import { EmployeeTabs } from '../employee-tabs';

export default function EmployeeTimePage() {
  const { employeeId } = useParams<{ employeeId: string }>();
  const { t } = useTranslation();
  return (
    <PageContainer>
      <TimeRecordsPage
        employeeId={employeeId}
        title={t('employees.time')}
        tabs={<EmployeeTabs />}
      />
    </PageContainer>
  );
}
