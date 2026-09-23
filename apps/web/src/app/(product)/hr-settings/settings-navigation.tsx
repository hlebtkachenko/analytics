'use client';

import Link from 'next/link';
import { useTranslation } from 'react-i18next';

import { withOrganization } from '../../../lib/hr/client';
import { useOrganizationSelection } from '../../../lib/organizations/use-organization-selection';

export function SettingsNavigation() {
  const { t } = useTranslation();
  const organization = useOrganizationSelection();
  const links = [
    ['/hr-settings/structure', 'hrSettings.structure'],
    ['/hr-settings/documents', 'hrSettings.documents'],
    ['/hr-settings/checklists', 'checklists.checklistTemplates'],
    ['/hr-settings/payroll', 'hrSettings.payroll'],
    ['/hr-settings/access', 'hrSettings.accessAssignments'],
  ] as const;
  return (
    <nav aria-label={t('hrSettings.navigation')}>
      {links.map(([href, label], index) => (
        <span key={href}>
          <Link href={withOrganization(href, organization.slug ?? '') as never}>
            {t(label)}
          </Link>
          {index < links.length - 1 ? ' ' : null}
        </span>
      ))}
    </nav>
  );
}
