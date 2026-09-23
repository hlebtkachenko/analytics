'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslation } from 'react-i18next';

import { useOrganizationSelection } from '../../../../lib/organizations/use-organization-selection';
import { withOrganization } from '../../../../lib/hr/client';

export function EmployeeTabs() {
  const { t } = useTranslation();
  const { employeeId } = useParams<{ employeeId: string }>();
  const organization = useOrganizationSelection();
  if (!organization.organizationId) return null;
  const base = `/employees/${encodeURIComponent(employeeId)}`;
  const overview = withOrganization(base, organization.slug);
  const employment = withOrganization(`${base}/employment`, organization.slug);
  const time = withOrganization(`${base}/time`, organization.slug);
  const leave = withOrganization(`${base}/leave`, organization.slug);
  const compensation = withOrganization(
    `${base}/compensation`,
    organization.slug,
  );
  const payroll = withOrganization(`${base}/payroll`, organization.slug);
  const documents = withOrganization(`${base}/documents`, organization.slug);
  const workflows = withOrganization(`${base}/workflows`, organization.slug);
  return (
    <nav aria-label={t('employees.sections')}>
      <Link href={overview as never}>{t('employees.overview')}</Link>{' '}
      <Link href={employment as never}>{t('employees.employment')}</Link>{' '}
      <Link href={compensation as never}>{t('employees.compensation')}</Link>{' '}
      <Link href={time as never}>{t('employees.time')}</Link>{' '}
      <Link href={leave as never}>{t('employees.leave')}</Link>{' '}
      <Link href={payroll as never}>{t('employees.payroll')}</Link>{' '}
      <Link href={documents as never}>{t('employees.documents')}</Link>{' '}
      <Link href={workflows as never}>{t('employees.workflows')}</Link>
    </nav>
  );
}
