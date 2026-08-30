import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../../i18n/client-provider';
import { DatasetExport } from './dataset-export';

const datasetId = '00000000-0000-4000-8000-000000000001';
const exportUrl = `/api/bff/application/organizations/organization_1/datasets/${datasetId}/export`;

beforeEach(() => {
  // jsdom ships no object URL implementation, and a streamed download must never reach for one.
  URL.createObjectURL = vi.fn(() => 'blob:dataset');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderExport(id = datasetId) {
  return render(
    <I18nProvider>
      <DatasetExport datasetId={id} organizationId="organization_1" />
    </I18nProvider>,
  );
}

// Records the anchor the component navigates with, which is the whole observable download.
function recordDownloads(): HTMLAnchorElement[] {
  const clicked: HTMLAnchorElement[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clicked.push(this);
  });
  return clicked;
}

describe('DatasetExport', () => {
  it('requests each format the export route accepts', () => {
    const clicked = recordDownloads();

    renderExport();

    fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }));
    fireEvent.click(screen.getByRole('button', { name: 'Download XLSX' }));

    expect(clicked).toHaveLength(2);
    expect(clicked.map((anchor) => anchor.getAttribute('href'))).toEqual([
      `${exportUrl}?format=csv`,
      `${exportUrl}?format=xlsx`,
    ]);
    // The saved name is derived from the dataset identifier, so no stored text can steer it.
    expect(clicked.map((anchor) => anchor.getAttribute('download'))).toEqual([
      `dataset-${datasetId}.csv`,
      `dataset-${datasetId}.xlsx`,
    ]);
  });

  it('hands the transfer to the browser instead of buffering it in the tab', () => {
    const clicked = recordDownloads();
    const fetchMock = vi.fn(async () => new Response('column\n'));
    vi.stubGlobal('fetch', fetchMock);

    renderExport();
    fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }));

    // No body reaches the tab: nothing is read here and no object URL is minted from one.
    expect(clicked).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('reports a refused download', async () => {
    const clicked = recordDownloads();

    // The only refusal the tab can observe: an identifier no export filename may be built from.
    renderExport('report"; rm');
    fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }));

    expect(
      await screen.findByText('The download could not be prepared.'),
    ).toBeVisible();
    expect(clicked).toHaveLength(0);
  });
});
