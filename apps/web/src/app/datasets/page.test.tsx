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
import DatasetsPage from './page';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const dataset = {
  createdAt: '2026-01-01T00:00:00.000Z',
  description: null,
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Placeholder dataset',
  rowCount: 2,
  status: 'ready',
  updatedAt: '2026-01-02T00:00:00.000Z',
};

const columns = [
  { inferredType: 'text', name: 'label', position: 0 },
  { inferredType: 'number', name: 'value', position: 1 },
];

function respondWithUpload(uploadData: boolean) {
  return vi.fn(async (input: string) => {
    if (input === '/api/auth/organization/list') {
      return Response.json([{ id: 'organization_1', name: 'Organization 1' }]);
    }

    if (input.includes('/rows')) {
      return Response.json({
        columns,
        datasetId: dataset.id,
        nextCursor: null,
        pageSize: 25,
        rows: [
          { data: { label: 'label-1', value: 1 }, rowNumber: 1 },
          { data: { label: 'label-2', value: 2 }, rowNumber: 2 },
        ],
      });
    }

    if (input.endsWith('/access')) {
      return Response.json({
        capabilities: {
          manageGrants: false,
          manageMembers: false,
          uploadData,
          useAi: true,
        },
        organizationId: 'organization_1',
        role: 'member',
        service: 'application-api',
      });
    }

    if (input.endsWith('/datasets')) {
      return Response.json({ datasets: [dataset] });
    }

    return new Response(null, { status: 404 });
  });
}

const secondDataset = {
  createdAt: '2026-01-01T00:00:00.000Z',
  description: null,
  id: '00000000-0000-4000-8000-000000000002',
  name: 'Second dataset',
  rowCount: 4,
  status: 'ready',
  updatedAt: '2026-01-02T00:00:00.000Z',
};

// One label per dataset and per cursor, so a row can only come from the dataset and page that was asked for.
function respondWithTwoDatasets() {
  return vi.fn(async (input: string) => {
    if (input === '/api/auth/organization/list') {
      return Response.json([{ id: 'organization_1', name: 'Organization 1' }]);
    }

    if (input === '/api/chat') {
      return new Response(
        'data: {"type":"text-delta","id":"0","delta":"An answer."}\n\ndata: [DONE]\n\n',
      );
    }

    if (input.includes('/rows')) {
      const url = new URL(input, 'http://localhost');
      const after = Number(url.searchParams.get('after') ?? '0');
      const requested = url.pathname.split('/').at(-2) ?? '';
      const origin = requested === dataset.id ? 'first' : 'second';
      return Response.json({
        columns,
        datasetId: requested,
        nextCursor: after === 0 ? 2 : null,
        pageSize: 25,
        rows: [
          {
            data: {
              label: `${origin}-row-${String(after + 1)}`,
              value: after + 1,
            },
            rowNumber: after + 1,
          },
        ],
      });
    }

    if (input.endsWith('/access')) {
      return Response.json({
        capabilities: {
          manageGrants: false,
          manageMembers: false,
          uploadData: true,
          useAi: true,
        },
        organizationId: 'organization_1',
        role: 'member',
        service: 'application-api',
      });
    }

    if (input.endsWith('/datasets')) {
      return Response.json({ datasets: [dataset, secondDataset] });
    }

    return new Response(null, { status: 404 });
  });
}

function rowsTable(): HTMLElement {
  return screen.getByRole('table', { name: 'Dataset rows' });
}

function renderDatasetsPage() {
  return render(
    <I18nProvider>
      <DatasetsPage />
    </I18nProvider>,
  );
}

describe('DatasetsPage', () => {
  it('lists the datasets the organization exposes', async () => {
    const fetchMock = respondWithUpload(true);
    vi.stubGlobal('fetch', fetchMock);

    renderDatasetsPage();

    expect(await screen.findByText('Placeholder dataset')).toBeVisible();
    expect(screen.getByText('Ready')).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Open Placeholder dataset' }),
    ).toBeVisible();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/bff/application/organizations/organization_1/datasets',
      expect.any(Object),
    );
  });

  it('skips no heading level once a dataset is open', async () => {
    vi.stubGlobal('fetch', respondWithUpload(true));

    const { container } = renderDatasetsPage();

    fireEvent.click(
      await screen.findByRole('button', { name: 'Open Placeholder dataset' }),
    );
    await screen.findByRole('table', { name: 'Dataset rows' });
    const levels = [...container.querySelectorAll('h1,h2,h3,h4,h5,h6')].map(
      (heading) => Number(heading.tagName.slice(1)),
    );

    expect(levels[0]).toBe(1);
    // The rendered outline, not the source: Carbon resolves its own heading levels.
    expect(levels).toEqual([1, 2, 2, 3, 2, 3, 3, 4, 3, 3]);

    for (const [index, level] of levels.entries()) {
      expect(level - (levels[index - 1] ?? level)).toBeLessThanOrEqual(1);
    }
  });

  it('opens a second dataset at its first page with no rows or chat carried over', async () => {
    const fetchMock = respondWithTwoDatasets();
    vi.stubGlobal('fetch', fetchMock);

    renderDatasetsPage();

    fireEvent.click(
      await screen.findByRole('button', { name: 'Open Placeholder dataset' }),
    );
    expect(
      within(
        await screen.findByRole('table', { name: 'Dataset rows' }),
      ).getByText('first-row-1'),
    ).toBeVisible();

    // Advance the first dataset past its first page and leave a turn in its chat log.
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => {
      expect(within(rowsTable()).getByText('first-row-3')).toBeVisible();
    });
    fireEvent.change(screen.getByLabelText('Message'), {
      target: { value: 'What does this page show?' },
    });
    fireEvent.submit(screen.getByRole('form', { name: 'Assistant' }));
    expect(await screen.findByText('An answer.')).toBeVisible();

    fireEvent.click(
      screen.getByRole('button', { name: 'Open Second dataset' }),
    );

    await waitFor(() => {
      expect(within(rowsTable()).getByText('second-row-1')).toBeVisible();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/bff/application/organizations/organization_1/datasets/${secondDataset.id}/rows?pageSize=25`,
      expect.any(Object),
    );
    expect(
      fetchMock.mock.calls.filter(
        (call) =>
          String(call[0]).includes(secondDataset.id) &&
          String(call[0]).includes('after='),
      ),
    ).toHaveLength(0);
    expect(screen.getByText('Page 1')).toBeVisible();
    expect(screen.queryByText('An answer.')).not.toBeInTheDocument();
    expect(
      screen.queryByText('What does this page show?'),
    ).not.toBeInTheDocument();
  });

  it('keeps a refused access resolution visible when the dataset list succeeds', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        if (input === '/api/auth/organization/list') {
          return Response.json([
            { id: 'organization_1', name: 'Organization 1' },
          ]);
        }

        if (input.endsWith('/access')) {
          return new Response(null, { status: 403 });
        }

        if (input.endsWith('/datasets')) {
          return Response.json({ datasets: [dataset] });
        }

        return new Response(null, { status: 404 });
      }),
    );

    renderDatasetsPage();

    // The list succeeding must not repaint the page as healthy while Open cannot work.
    expect(
      await screen.findByText('Organization access could not be checked.'),
    ).toBeVisible();
    expect(screen.getByText('Placeholder dataset')).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Upload data' }),
    ).not.toBeInTheDocument();
  });

  it('hides the upload control from an account without the capability', async () => {
    vi.stubGlobal('fetch', respondWithUpload(false));
    renderDatasetsPage();

    expect(await screen.findByText('Placeholder dataset')).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Upload data' }),
    ).not.toBeInTheDocument();

    cleanup();
    vi.stubGlobal('fetch', respondWithUpload(true));
    renderDatasetsPage();

    expect(
      await screen.findByRole('button', { name: 'Upload data' }),
    ).toBeVisible();
  });
});
