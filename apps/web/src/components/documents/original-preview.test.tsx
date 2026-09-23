import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../../i18n/client-provider';
import OriginalPreview from './original-preview';

const ORG_ID = 'organization_1';
const BLOB_ID = '00000000-0000-4000-8000-000000000060';

function file(mediaType: string, byteSize = 20) {
  return {
    blobId: BLOB_ID,
    byteSize,
    mediaType,
    name: 'placeholder.csv',
  };
}

function renderPreview(mediaType: string) {
  return render(
    <I18nProvider>
      <OriginalPreview
        file={file(mediaType)}
        frameTitle="Original preview"
        noPreviewLabel="No inline preview is available."
        organizationId={ORG_ID}
      />
    </I18nProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('OriginalPreview', () => {
  it('renders the text body read from the download route', async () => {
    const fetchMock = vi.fn(async (input: string) => {
      // The inline route serves only pdf and images, so text must read the download route.
      if (input.endsWith(`/blobs/${BLOB_ID}/download`)) {
        return new Response('code,amount\na,1');
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    renderPreview('text/csv');

    expect(
      await screen.findByText('code,amount', { exact: false }),
    ).toBeVisible();
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some((call) =>
          String(call[0]).endsWith(`/blobs/${BLOB_ID}/download`),
        ),
      ).toBe(true);
    });
  });

  it('frames a pdf from the inline route under the caller title, unsandboxed for the PDF viewer', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 404 })),
    );

    renderPreview('application/pdf');

    const frame = screen.getByTitle('Original preview');
    expect(frame.tagName).toBe('IFRAME');
    expect(frame).toHaveAttribute(
      'src',
      `/api/bff/application/organizations/${ORG_ID}/inbox/blobs/${BLOB_ID}/inline`,
    );
    expect(frame).not.toHaveAttribute('sandbox');
  });

  it('shows the download card for an svg the frame will not render inline', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 404 })),
    );

    renderPreview('image/svg+xml');

    // No broken <img> for a type the BFF refuses inline; the neutral card stands in.
    expect(screen.getByText('No inline preview is available.')).toBeVisible();
    expect(screen.queryByRole('img')).toBeNull();
  });
});
