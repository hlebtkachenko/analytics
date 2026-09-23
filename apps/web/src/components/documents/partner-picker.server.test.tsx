// @vitest-environment node
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { I18nProvider } from '../../i18n/client-provider';
import { ToastProvider } from '../shell/toast';
import PartnerPicker from './partner-picker';

describe('PartnerPicker on the server', () => {
  it('renders without a document and leaves the modal out of the HTML', () => {
    const html = renderToString(
      <I18nProvider>
        <ToastProvider>
          <PartnerPicker
            idPrefix="test"
            onSelect={() => undefined}
            organizationId="organization_1"
            selectedPartnerId=""
          />
        </ToastProvider>
      </I18nProvider>,
    );

    expect(html).toContain('Create partner');
    expect(html).not.toContain('test-partner-name');
  });
});
