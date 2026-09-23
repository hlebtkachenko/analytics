import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/organizations/use-organization-selection', () => ({
  useOrganizationSelection: () => ({
    organizationId: 'org_1',
    slug: 'selected org',
  }),
}));
import { I18nProvider } from '../../../i18n/client-provider';
import { SettingsNavigation } from './settings-navigation';

describe('SettingsNavigation', () => {
  it('uses the complete stable settings order and preserves organization selection', () => {
    render(
      <I18nProvider>
        <SettingsNavigation />
      </I18nProvider>,
    );
    expect(screen.getAllByRole('link').map((link) => link.textContent)).toEqual(
      [
        'Structure',
        'Documents',
        'Checklist templates',
        'Payroll',
        'Access assignments',
      ],
    );
    for (const link of screen.getAllByRole('link')) {
      expect(link).toHaveAttribute(
        'href',
        expect.stringContaining('organization=selected%20org'),
      );
    }
  });
});
