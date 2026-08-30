import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
