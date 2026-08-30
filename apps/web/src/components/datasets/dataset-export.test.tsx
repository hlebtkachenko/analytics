import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../../i18n/client-provider';
import { DatasetExport } from './dataset-export';

const datasetId = '00000000-0000-4000-8000-000000000001';

beforeEach(() => {
  // jsdom ships no object URL implementation, so the download path gets a stub.
  URL.createObjectURL = vi.fn(() => 'blob:dataset');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderExport() {
  return render(
    <I18nProvider>
      <DatasetExport datasetId={datasetId} organizationId="organization_1" />
    </I18nProvider>,
  );
}

describe('DatasetExport', () => {
  it('requests each format the export route accepts', async () => {
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    const fetchMock = vi.fn(async () => new Response('column\n'));
    vi.stubGlobal('fetch', fetchMock);

    renderExport();

    fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/bff/application/organizations/organization_1/datasets/${datasetId}/export?format=csv`,
        expect.any(Object),
      );
    });

    fireEvent.click(screen.getByRole('button', { name: 'Download XLSX' }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/bff/application/organizations/organization_1/datasets/${datasetId}/export?format=xlsx`,
        expect.any(Object),
      );
    });
    expect(click).toHaveBeenCalledTimes(2);
  });

  it('reports a refused download', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 403 })),
    );

    renderExport();
    fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }));

    expect(
      await screen.findByText('The download could not be prepared.'),
    ).toBeVisible();
  });
});
