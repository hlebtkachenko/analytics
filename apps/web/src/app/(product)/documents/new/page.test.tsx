import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const push = vi.fn();

vi.mock('next/navigation', () => ({
  useParams: () => ({}),
  useRouter: () => ({ push, refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}));

import { ToastProvider } from '../../../../components/shell/toast';
import { I18nProvider } from '../../../../i18n/client-provider';
import NewDocumentPage from './page';

const LEGAL_ENTITY_ID = '9b7d1c30-6a4b-4d1f-9c2e-7a5f0e3b8d21';
const PARTNER_ID = '4c2f8b11-8c35-4a2e-9f61-1de2f0a7c934';
const DOCUMENT_ID = '00000000-0000-4000-8000-000000000010';

const legalEntities = {
  legalEntities: [
    {
      createdAt: '2026-01-01T00:00:00.000Z',
      id: LEGAL_ENTITY_ID,
      kind: 'company',
      name: 'Placeholder Holding',
      registrationNumber: null,
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
};

const partner = {
  countryCode: 'CZ',
  createdAt: '2026-01-01T00:00:00.000Z',
  id: PARTNER_ID,
  legalEntityId: null,
  name: 'Placeholder Supplier',
  registrationNumber: null,
  updatedAt: '2026-01-01T00:00:00.000Z',
  vatNumber: null,
};

const createdDetail = {
  attributes: {},
  document: {
    createdAt: '2026-09-01T00:00:00.000Z',
    currencyCode: 'CZK',
    documentDate: '2026-09-01',
    hasEvent: true,
    id: DOCUMENT_ID,
    isBalanced: true,
    isCurrent: true,
    kind: 'issued_invoice',
    legalEntityId: LEGAL_ENTITY_ID,
    openIssueCount: 0,
    partnerId: null,
    partnerName: null,
    reference: null,
    source: 'manual',
    status: 'registered',
    title: 'Placeholder document',
    totalAmount: '1210.0000',
    updatedAt: '2026-09-01T00:00:00.000Z',
    validFrom: null,
    validTo: null,
    version: 1,
  },
  event: null,
  invoice: null,
  issues: [],
  links: [],
};

const posted: { body?: unknown; path?: string } = {};

function respond() {
  return vi.fn(async (input: string, init?: RequestInit) => {
    if (input === '/api/auth/organization/list') {
      return Response.json([
        {
          id: 'organization_1',
          name: 'Organization 1',
          slug: 'organization-1',
        },
      ]);
    }

    if (input.endsWith('/legal-entities')) {
      return Response.json(legalEntities);
    }

    if (input.includes('/partners') && init?.method === 'POST') {
      posted.body = JSON.parse(String(init.body));
      posted.path = input;
      return Response.json(partner, { status: 201 });
    }

    if (input.includes('/partners')) {
      return Response.json({ partners: [partner] });
    }

    if (input.includes('/documents') && init?.method === 'POST') {
      posted.body = JSON.parse(String(init.body));
      posted.path = input;
      return Response.json(createdDetail, { status: 201 });
    }

    return new Response(null, { status: 404 });
  });
}

function renderNewDocumentPage() {
  return render(
    <I18nProvider>
      <ToastProvider>
        <NewDocumentPage />
      </ToastProvider>
    </I18nProvider>,
  );
}

afterEach(() => {
  cleanup();
  delete posted.body;
  delete posted.path;
  push.mockReset();
  vi.unstubAllGlobals();
});

describe('NewDocumentPage', () => {
  it('posts a minimal issued invoice and continues to the registered document', async () => {
    vi.stubGlobal('fetch', respond());

    renderNewDocumentPage();
    await screen.findByDisplayValue('Placeholder Holding');

    fireEvent.change(screen.getByLabelText('Kind'), {
      target: { value: 'issued_invoice' },
    });
    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Placeholder document' },
    });
    fireEvent.change(screen.getByLabelText('Document date'), {
      target: { value: '2026-09-01' },
    });
    fireEvent.change(screen.getByLabelText('Description 1'), {
      target: { value: 'Placeholder line' },
    });
    fireEvent.change(screen.getByLabelText('Base amount 1'), {
      target: { value: '1000' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Register document' }));

    await waitFor(() => {
      expect(posted.body).toBeDefined();
    });
    expect(posted.path).toBe(
      '/api/bff/application/organizations/organization_1/documents',
    );
    expect(posted.body).toEqual({
      currencyCode: 'CZK',
      documentDate: '2026-09-01',
      invoice: {
        lines: [
          {
            baseAmount: '1000',
            category: 'services',
            description: 'Placeholder line',
            lineKind: 'item',
            vatAmount: '210.00',
            vatMode: 'standard',
            vatRate: '21',
          },
        ],
        roundingAmount: '0',
      },
      kind: 'issued_invoice',
      legalEntityId: LEGAL_ENTITY_ID,
      title: 'Placeholder document',
    });
    await waitFor(() => {
      expect(push).toHaveBeenCalledWith(
        `/documents/${DOCUMENT_ID}?organization=organization-1`,
      );
    });
  });

  it('clears the rate as well as the amount when a line leaves standard VAT', async () => {
    vi.stubGlobal('fetch', respond());

    renderNewDocumentPage();
    await screen.findByDisplayValue('Placeholder Holding');

    fireEvent.change(screen.getByLabelText('Kind'), {
      target: { value: 'issued_invoice' },
    });
    fireEvent.change(screen.getByLabelText('Base amount 1'), {
      target: { value: '1000' },
    });
    expect(screen.getByLabelText('VAT amount 1')).toHaveValue('210.00');

    fireEvent.change(screen.getByLabelText('VAT mode 1'), {
      target: { value: 'exempt' },
    });

    expect(screen.getByLabelText('VAT rate 1')).toHaveValue('0');
    expect(screen.getByLabelText('VAT amount 1')).toHaveValue('0');
  });

  it('rounds the derived VAT half away from zero on the minor unit', async () => {
    vi.stubGlobal('fetch', respond());

    renderNewDocumentPage();
    await screen.findByDisplayValue('Placeholder Holding');

    fireEvent.change(screen.getByLabelText('Kind'), {
      target: { value: 'issued_invoice' },
    });
    fireEvent.change(screen.getByLabelText('VAT rate 1'), {
      target: { value: '15' },
    });
    fireEvent.change(screen.getByLabelText('Base amount 1'), {
      target: { value: '4.10' },
    });

    // A float would land on 0.61 here, because 4.1 times 15 is not exact in binary.
    expect(screen.getByLabelText('VAT amount 1')).toHaveValue('0.62');
  });

  it('refuses an incomplete document before any request is sent', async () => {
    const fetchMock = respond();
    vi.stubGlobal('fetch', fetchMock);

    renderNewDocumentPage();
    await screen.findByDisplayValue('Placeholder Holding');

    fireEvent.click(screen.getByRole('button', { name: 'Register document' }));

    expect(
      await screen.findByText('Check the highlighted fields and try again.'),
    ).toBeVisible();
    expect(posted.body).toBeUndefined();
  });

  it('creates a partner inline and keeps it selected for the document', async () => {
    vi.stubGlobal('fetch', respond());

    renderNewDocumentPage();
    await screen.findByDisplayValue('Placeholder Holding');

    fireEvent.click(screen.getByRole('button', { name: 'Create partner' }));
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Placeholder Supplier' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(posted.body).toEqual({ name: 'Placeholder Supplier' });
    });
    expect(posted.path).toBe(
      '/api/bff/application/organizations/organization_1/partners',
    );
    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: 'Partner' })).toHaveValue(
        'Placeholder Supplier',
      );
    });
  });

  it('disables the category, the tax point and the period on an advance deduction', async () => {
    vi.stubGlobal('fetch', respond());

    renderNewDocumentPage();
    await screen.findByDisplayValue('Placeholder Holding');

    expect(screen.getByLabelText('Category 1')).toHaveValue('services');
    fireEvent.change(screen.getByLabelText('Tax point date 1'), {
      target: { value: '2026-09-30' },
    });

    fireEvent.change(screen.getByLabelText('Line kind 1'), {
      target: { value: 'advance_deduction' },
    });

    expect(screen.getByLabelText('Category 1')).toBeDisabled();
    // The settlement legs take the tax point of this invoice, so the line drops its own dates.
    expect(screen.getByLabelText('Tax point date 1')).toBeDisabled();
    expect(screen.getByLabelText('Tax point date 1')).toHaveValue('');
    expect(screen.getByLabelText('Period start 1')).toBeDisabled();
    expect(screen.getByLabelText('Period end 1')).toBeDisabled();
  });

  it('sends no category and no dates on an advance deduction line', async () => {
    vi.stubGlobal('fetch', respond());

    renderNewDocumentPage();
    await screen.findByDisplayValue('Placeholder Holding');

    fireEvent.change(screen.getByLabelText('Kind'), {
      target: { value: 'issued_invoice' },
    });
    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Placeholder document' },
    });
    fireEvent.change(screen.getByLabelText('Document date'), {
      target: { value: '2026-09-01' },
    });
    fireEvent.change(screen.getByLabelText('Description 1'), {
      target: { value: 'Placeholder line' },
    });
    fireEvent.change(screen.getByLabelText('Base amount 1'), {
      target: { value: '1000' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add line' }));
    fireEvent.change(screen.getByLabelText('Description 2'), {
      target: { value: 'Placeholder advance' },
    });
    fireEvent.change(screen.getByLabelText('Line kind 2'), {
      target: { value: 'advance_deduction' },
    });
    fireEvent.change(screen.getByLabelText('Base amount 2'), {
      target: { value: '500' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Register document' }));

    await waitFor(() => {
      expect(posted.body).toBeDefined();
    });
    expect(
      (posted.body as { invoice: { lines: unknown[] } }).invoice.lines[1],
    ).toEqual({
      baseAmount: '500',
      description: 'Placeholder advance',
      lineKind: 'advance_deduction',
      vatAmount: '105.00',
      vatMode: 'standard',
      vatRate: '21',
    });
  });

  it('registers the invoice when the rounding field is cleared', async () => {
    vi.stubGlobal('fetch', respond());

    renderNewDocumentPage();
    await screen.findByDisplayValue('Placeholder Holding');

    fireEvent.change(screen.getByLabelText('Kind'), {
      target: { value: 'issued_invoice' },
    });
    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Placeholder document' },
    });
    fireEvent.change(screen.getByLabelText('Document date'), {
      target: { value: '2026-09-01' },
    });
    fireEvent.change(screen.getByLabelText('Description 1'), {
      target: { value: 'Placeholder line' },
    });
    fireEvent.change(screen.getByLabelText('Base amount 1'), {
      target: { value: '1000' },
    });
    // A cleared field is an absent field, so the contract default stands instead of an empty string.
    fireEvent.change(screen.getByLabelText('Rounding'), {
      target: { value: '' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Register document' }));

    await waitFor(() => {
      expect(posted.body).toBeDefined();
    });
    expect(
      (posted.body as { invoice: { roundingAmount: string } }).invoice
        .roundingAmount,
    ).toBe('0');
  });

  it('previews the amount due from the supply lines, the advance and the rounding', async () => {
    vi.stubGlobal('fetch', respond());

    renderNewDocumentPage();
    await screen.findByDisplayValue('Placeholder Holding');

    fireEvent.change(screen.getByLabelText('Base amount 1'), {
      target: { value: '1000' },
    });
    fireEvent.change(screen.getByLabelText('Rounding'), {
      target: { value: '0.20' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add line' }));
    fireEvent.change(screen.getByLabelText('Line kind 2'), {
      target: { value: 'advance_deduction' },
    });
    fireEvent.change(screen.getByLabelText('Base amount 2'), {
      target: { value: '500' },
    });

    const totals = screen.getByLabelText('Invoice totals');
    // Gross 1210.00 plus rounding 0.20 less the deducted 605.00 leaves 605.20 to pay.
    expect(within(totals).getByText('CZK 1,210.00')).toBeVisible();
    expect(within(totals).getByText('CZK 0.20')).toBeVisible();
    expect(within(totals).getByText('CZK 605.00')).toBeVisible();
    expect(within(totals).getByText('CZK 605.20')).toBeVisible();
  });
});
