import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const employeeId = '00000000-0000-4000-8000-000000000001';
const documentId = '00000000-0000-4000-8000-000000000002';
const categoryId = '00000000-0000-4000-8000-000000000003';
const accessMock = vi.hoisted(() => vi.fn());
const organizationMock = vi.hoisted(() => vi.fn());
const searchMock = vi.hoisted(() => vi.fn());
const routerReplace = vi.hoisted(() => vi.fn());
const notifyMock = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useParams: () => ({ employeeId }),
  usePathname: () => `/employees/${employeeId}/documents`,
  useRouter: () => ({ replace: routerReplace }),
  useSearchParams: searchMock,
}));
vi.mock('../../../../../lib/organizations/use-organization-selection', () => ({
  useOrganizationSelection: organizationMock,
}));
vi.mock('../../../../../lib/organizations/use-organization-access', () => ({
  useOrganizationAccess: accessMock,
}));
vi.mock('../../../../../lib/datasets/client', () => ({
  getJson: vi.fn(),
  organizationPath: (id: string) => `/api/organizations/${id}`,
}));
vi.mock('../../../../../components/shell/toast', () => ({
  useToast: () => ({ notify: notifyMock }),
}));

import { I18nProvider } from '../../../../../i18n/client-provider';
import { getJson } from '../../../../../lib/datasets/client';
import EmployeeDocumentsPage from './page';

const employee = {
  id: employeeId,
  legalEntityId: '00000000-0000-4000-8000-000000000010',
  employeeNumber: 'EMP-1',
  firstName: 'Ada',
  lastName: 'Lovelace',
  workEmail: null,
  workPhone: null,
  status: 'active',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  relationships: [],
  documents: [],
};
const document = {
  documentId,
  title: 'Contract',
  documentDate: '2026-01-01',
  categoryId,
  relationshipId: null,
  approvalStatus: 'pending',
  approvedBy: null,
  approvedAt: null,
  supersedesDocumentId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};
const category = {
  id: categoryId,
  legalEntityId: employee.legalEntityId,
  code: 'CONTRACT',
  name: 'Contract',
  active: true,
  confidentiality: 'operational',
  retentionKey: 'hr',
  requiresApproval: true,
  createdAt: employee.createdAt,
  updatedAt: employee.updatedAt,
} as const;

function renderPage() {
  return render(
    <I18nProvider>
      <EmployeeDocumentsPage />
    </I18nProvider>,
  );
}
beforeEach(() => {
  organizationMock.mockReturnValue({
    organizationId: 'org_1',
    slug: 'test',
    state: 'ready',
  });
  accessMock.mockReturnValue({
    access: { capabilities: { readHr: true, manageHr: true } },
    state: 'ready',
  });
  searchMock.mockReturnValue(
    new URLSearchParams(
      'categoryId=bad&approvalStatus=nope&currentOnly=x&page=0&pageSize=999',
    ),
  );
  vi.mocked(getJson).mockImplementation((path: string) =>
    Promise.resolve(
      path.includes('document-categories')
        ? { documentCategories: [category], page: 1, pageSize: 100, total: 1 }
        : path.includes('/documents?')
          ? { items: [document], page: 1, pageSize: 25, total: 1 }
          : employee,
    ),
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(Response.json(document))),
  );
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('EmployeeDocumentsPage', () => {
  it('sanitizes filters and renders operational document rows', async () => {
    renderPage();
    expect((await screen.findAllByText('Contract')).length).toBeGreaterThan(0);
    expect(vi.mocked(getJson)).toHaveBeenCalledWith(
      `/api/organizations/org_1/employees/${employeeId}/documents?currentOnly=true&page=1&pageSize=25`,
      expect.any(AbortSignal),
    );
    expect(screen.getAllByText('Pending').length).toBeGreaterThan(0);
  });
  it('does not fetch and shows forbidden state without read HR', async () => {
    accessMock.mockReturnValue({
      access: { capabilities: { readHr: false, manageHr: false } },
      state: 'ready',
    });
    renderPage();
    expect(await screen.findByText(/cannot read HR/)).toBeVisible();
    expect(getJson).not.toHaveBeenCalled();
  });
  it('shows loading then an error state', async () => {
    vi.mocked(getJson).mockRejectedValue(new Error('unavailable'));
    renderPage();
    expect(screen.getByText('Loading employee.')).toBeVisible();
    expect(
      await screen.findByText('Employee documents could not be loaded.'),
    ).toBeVisible();
  });
  it('accepts only operational contract rows', async () => {
    vi.mocked(getJson).mockImplementation((path: string) =>
      Promise.resolve(
        path.includes('/documents?')
          ? {
              items: [{ ...document, approvalStatus: 'unknown' }],
              page: 1,
              pageSize: 25,
              total: 1,
            }
          : path.includes('document-categories')
            ? {
                documentCategories: [category],
                page: 1,
                pageSize: 100,
                total: 1,
              }
            : employee,
      ),
    );
    renderPage();
    expect(
      await screen.findByText('Employee documents could not be loaded.'),
    ).toBeVisible();
  });
  it('renders an empty state and hides all mutation controls for read-only access', async () => {
    accessMock.mockReturnValue({
      access: { capabilities: { readHr: true, manageHr: false } },
      state: 'ready',
    });
    vi.mocked(getJson).mockImplementation((path: string) =>
      Promise.resolve(
        path.includes('/documents?')
          ? { items: [], page: 1, pageSize: 25, total: 0 }
          : path.includes('document-categories')
            ? {
                documentCategories: [category],
                page: 1,
                pageSize: 100,
                total: 1,
              }
            : employee,
      ),
    );
    renderPage();
    expect(await screen.findByText('No documents are linked.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Link document' })).toBeNull();
  });
  it('shows not-required approvals', async () => {
    vi.mocked(getJson).mockImplementation((path: string) =>
      Promise.resolve(
        path.includes('/documents?')
          ? {
              items: [{ ...document, approvalStatus: 'not_required' }],
              page: 1,
              pageSize: 25,
              total: 1,
            }
          : path.includes('document-categories')
            ? {
                documentCategories: [category],
                page: 1,
                pageSize: 100,
                total: 1,
              }
            : employee,
      ),
    );
    renderPage();
    expect((await screen.findAllByText('Not required')).length).toBeGreaterThan(
      0,
    );
  });
  it('labels a predecessor superseded when all documents are requested', async () => {
    searchMock.mockReturnValue(
      new URLSearchParams('currentOnly=false&page=2&pageSize=25'),
    );
    const successor = {
      ...document,
      documentId: '00000000-0000-4000-8000-000000000004',
      title: 'Replacement',
      supersedesDocumentId: documentId,
    };
    vi.mocked(getJson).mockImplementation((path: string) =>
      Promise.resolve(
        path.includes('/documents?')
          ? { items: [document, successor], page: 2, pageSize: 25, total: 2 }
          : path.includes('document-categories')
            ? {
                documentCategories: [category],
                page: 1,
                pageSize: 100,
                total: 1,
              }
            : employee,
      ),
    );
    renderPage();
    expect(await screen.findByText('Superseded')).toBeVisible();
    expect(vi.mocked(getJson)).toHaveBeenCalledWith(
      `/api/organizations/org_1/employees/${employeeId}/documents?currentOnly=false&page=2&pageSize=25`,
      expect.any(AbortSignal),
    );
  });
  it('preserves a valid page above 100 and exposes router-backed filter controls', async () => {
    searchMock.mockReturnValue(new URLSearchParams('page=101&pageSize=25'));
    renderPage();
    await screen.findAllByText('Contract');
    expect(vi.mocked(getJson)).toHaveBeenCalledWith(
      `/api/organizations/org_1/employees/${employeeId}/documents?currentOnly=true&page=101&pageSize=25`,
      expect.any(AbortSignal),
    );
  });
  it.each([
    ['Approve', 'approved'],
    ['Reject', 'rejected'],
  ] as const)(
    'sends only the %s approval decision from an activated pending row',
    async (label, approvalDecision) => {
      renderPage();
      const row = (await screen.findAllByText('Contract'))[0]!.closest('tr')!;
      fireEvent.click(row);
      fireEvent.click(await screen.findByRole('button', { name: label }));
      await waitFor(() => expect(fetch).toHaveBeenCalled());
      expect(fetch).toHaveBeenCalledWith(
        `/api/organizations/org_1/employees/${employeeId}/documents/${documentId}`,
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ approvalDecision }),
        }),
      );
    },
  );
  it('does not open an edit modal from a row without manage HR', async () => {
    accessMock.mockReturnValue({
      access: { capabilities: { readHr: true, manageHr: false } },
      state: 'ready',
    });
    renderPage();
    fireEvent.click(
      (await screen.findAllByText('Contract'))[0]!.closest('tr')!,
    );
    expect(screen.queryByRole('heading', { name: 'Edit document' })).toBeNull();
  });
  it('keeps an edit modal open on a conflict', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(null, { status: 409 }))),
    );
    renderPage();
    fireEvent.click(
      (await screen.findAllByText('Contract'))[0]!.closest('tr')!,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    expect(
      await screen.findByText('This document was changed by another user.'),
    ).toBeVisible();
    expect(screen.getByRole('dialog')).toBeVisible();
  });
  it('links a document with the exact create body and resets its controlled id on close', async () => {
    renderPage();
    const requestsBeforeSave = vi.mocked(getJson).mock.calls.length;
    fireEvent.click(
      await screen.findByRole('button', { name: 'Link document' }),
    );
    fireEvent.change(screen.getByLabelText('Document ID'), {
      target: { value: documentId },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    fireEvent.click((await screen.findAllByText('CONTRACT Contract')).at(-1)!);
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(fetch).toHaveBeenCalledWith(
      `/api/organizations/org_1/employees/${employeeId}/documents`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          documentId,
          categoryId,
          relationshipId: null,
          supersedesDocumentId: null,
        }),
      }),
    );
    expect(notifyMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'success' }),
    );
    await waitFor(() =>
      expect(vi.mocked(getJson).mock.calls.length).toBeGreaterThan(
        requestsBeforeSave,
      ),
    );
    expect(screen.getByLabelText('Document ID')).toHaveValue('');
  });
  it('resets the controlled link id after close and reopen', async () => {
    renderPage();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Link document' }),
    );
    fireEvent.change(screen.getByLabelText('Document ID'), {
      target: { value: documentId },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'Link document' }));
    expect(screen.getByLabelText('Document ID')).toHaveValue('');
  });
  it('patches only a changed predecessor and skips a no-change edit', async () => {
    const predecessor = {
      ...document,
      documentId: '00000000-0000-4000-8000-000000000004',
      title: 'Earlier contract',
    };
    vi.mocked(getJson).mockImplementation((path: string) =>
      Promise.resolve(
        path.includes('/documents?')
          ? {
              items: path.includes('page=1&pageSize=100')
                ? [document, predecessor]
                : [document],
              page: 1,
              pageSize: 25,
              total: 1,
            }
          : path.includes('document-categories')
            ? {
                documentCategories: [category],
                page: 1,
                pageSize: 100,
                total: 1,
              }
            : employee,
      ),
    );
    renderPage();
    fireEvent.click(
      (await screen.findAllByText('Contract'))[0]!.closest('tr')!,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Predecessor'), {
      target: { value: predecessor.documentId },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(fetch).toHaveBeenCalledWith(
      `/api/organizations/org_1/employees/${employeeId}/documents/${documentId}`,
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ supersedesDocumentId: predecessor.documentId }),
      }),
    );
  });
  it('keeps an edit modal open for a general mutation error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(null, { status: 500 }))),
    );
    renderPage();
    fireEvent.click(
      (await screen.findAllByText('Contract'))[0]!.closest('tr')!,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    expect(
      await screen.findByText('The document change could not be saved.'),
    ).toBeVisible();
    expect(screen.getByRole('dialog')).toBeVisible();
  });
  it('uses router-backed filter controls and requests independent bounded predecessors', async () => {
    renderPage();
    await screen.findAllByText('Contract');
    expect(vi.mocked(getJson)).toHaveBeenCalledWith(
      `/api/organizations/org_1/employees/${employeeId}/documents?currentOnly=true&page=1&pageSize=100`,
      expect.any(AbortSignal),
    );
    fireEvent.change(screen.getByLabelText('Approval status'), {
      target: { value: 'not_required' },
    });
    expect(routerReplace).toHaveBeenCalledWith(
      expect.stringContaining('approvalStatus=not_required'),
    );
  });
});
