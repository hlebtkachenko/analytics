import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../../i18n/client-provider';
import { DatasetView } from './dataset-view';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const datasetId = '00000000-0000-4000-8000-000000000001';
const rowsUrl = `/api/bff/application/organizations/organization_1/datasets/${datasetId}/rows`;

const dataset = {
  createdAt: '2026-01-01T00:00:00.000Z',
  description: null,
  id: datasetId,
  name: 'Placeholder dataset',
  rowCount: 4,
  status: 'ready' as const,
  updatedAt: '2026-01-02T00:00:00.000Z',
};

const columns = [
  { inferredType: 'text', name: 'label', position: 0 },
  { inferredType: 'number', name: 'value', position: 1 },
];

function rowPage(after: number, nextCursor: number | null) {
  return {
    columns,
    datasetId,
    nextCursor,
    pageSize: 25,
    rows: [
      {
        data: { label: `label-${String(after + 1)}`, value: after + 1 },
        rowNumber: after + 1,
      },
      {
        data: { label: `label-${String(after + 2)}`, value: after + 2 },
        rowNumber: after + 2,
      },
    ],
  };
}

function pagedFetch() {
  return vi.fn(async (input: string) =>
    Response.json(input.includes('after=2') ? rowPage(2, null) : rowPage(0, 2)),
  );
}

function renderDatasetView(useAi = false) {
  return render(
    <I18nProvider>
      <DatasetView
        dataset={dataset}
        onClose={() => undefined}
        organizationId="organization_1"
        useAi={useAi}
      />
    </I18nProvider>,
  );
}

async function findRowsTable(): Promise<HTMLElement> {
  return await screen.findByRole('table', { name: 'Dataset rows' });
}

describe('DatasetView', () => {
  it('asks the server for the next keyset page instead of slicing rows locally', async () => {
    const fetchMock = pagedFetch();
    vi.stubGlobal('fetch', fetchMock);

    renderDatasetView();

    expect(within(await findRowsTable()).getByText('label-1')).toBeVisible();
    expect(fetchMock).toHaveBeenCalledWith(
      `${rowsUrl}?pageSize=25`,
      expect.any(Object),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        `${rowsUrl}?after=2&pageSize=25`,
        expect.any(Object),
      );
    });
    await waitFor(() => {
      expect(
        within(screen.getByRole('table', { name: 'Dataset rows' })).getByText(
          'label-3',
        ),
      ).toBeVisible();
    });
    expect(
      within(screen.getByRole('table', { name: 'Dataset rows' })).queryByText(
        'label-1',
      ),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Page 2')).toBeVisible();
  });

  it('steps back to the page it already requested', async () => {
    vi.stubGlobal('fetch', pagedFetch());

    renderDatasetView();

    expect(within(await findRowsTable()).getByText('label-1')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => {
      expect(
        within(screen.getByRole('table', { name: 'Dataset rows' })).getByText(
          'label-3',
        ),
      ).toBeVisible();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));

    await waitFor(() => {
      expect(
        within(screen.getByRole('table', { name: 'Dataset rows' })).getByText(
          'label-1',
        ),
      ).toBeVisible();
    });
    expect(screen.getByText('Page 1')).toBeVisible();
  });

  it('renders no element a nonce content security policy would block', async () => {
    vi.stubGlobal('fetch', pagedFetch());

    const { container } = renderDatasetView(true);

    await findRowsTable();
    expect(container.querySelectorAll('style')).toHaveLength(0);
    expect(container.querySelectorAll('script')).toHaveLength(0);
  });
});
