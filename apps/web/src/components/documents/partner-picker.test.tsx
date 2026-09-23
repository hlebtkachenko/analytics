import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../../i18n/client-provider';
import { ToastProvider } from '../shell/toast';
import PartnerPicker from './partner-picker';

const PARTNER_ID = '4c2f8b11-8c35-4a2e-9f61-1de2f0a7c934';

function respond() {
  return vi.fn(async (_input: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      return Response.json({
        countryCode: null,
        createdAt: '2026-09-01T00:00:00.000Z',
        id: PARTNER_ID,
        legalEntityId: null,
        name: 'Placeholder Supplier',
        registrationNumber: null,
        updatedAt: '2026-09-01T00:00:00.000Z',
        vatNumber: null,
      });
    }
    return Response.json({ partners: [] });
  });
}

function renderPicker(onSelect = vi.fn(), disabled = false) {
  return render(
    <I18nProvider>
      <ToastProvider>
        <form aria-label="Host form">
          <PartnerPicker
            disabled={disabled}
            idPrefix="test"
            onSelect={onSelect}
            organizationId="organization_1"
            selectedPartnerId=""
          />
        </form>
      </ToastProvider>
    </I18nProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('PartnerPicker', () => {
  it('creates a partner outside the host form and hands its id back', async () => {
    vi.stubGlobal('fetch', respond());
    const onSelect = vi.fn();
    renderPicker(onSelect);

    fireEvent.click(screen.getByRole('button', { name: 'Create partner' }));
    const name = screen.getByLabelText('Name');
    // Enter in the modal must never submit the page's own form.
    expect(
      screen.getByRole('form', { name: 'Host form' }),
    ).not.toContainElement(name);
    fireEvent.change(name, { target: { value: 'Placeholder Supplier' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(onSelect).toHaveBeenCalledWith(PARTNER_ID);
    });
  });

  it('returns focus to the launcher button after Cancel', async () => {
    vi.stubGlobal('fetch', respond());
    renderPicker();

    const launcher = screen.getByRole('button', { name: 'Create partner' });
    fireEvent.click(launcher);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(launcher).toHaveFocus();
    });
  });

  it('offers no create action and a disabled search when read only', () => {
    vi.stubGlobal('fetch', respond());
    renderPicker(vi.fn(), true);

    expect(screen.getByRole('combobox', { name: 'Partner' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Create partner' })).toBeNull();
  });
});
