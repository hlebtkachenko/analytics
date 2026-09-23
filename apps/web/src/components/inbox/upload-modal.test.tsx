import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../../i18n/client-provider';
import { UploadModal } from './upload-modal';

const ORGANIZATION_ID = 'organization_1';

// A valid upload response item; the inbox item schema is strict, so every field is present.
const uploadedItem = {
  assigneeId: null,
  channelId: null,
  channelKind: 'upload',
  confidence: 0.8,
  createdAt: '2026-09-16T08:00:00.000Z',
  datasetId: null,
  decidedByKind: null,
  decidedByRuleId: null,
  decidedByUserId: null,
  detectedType: 'pdf',
  documentId: null,
  duplicateOfItemId: null,
  hintKind: null,
  hintLegalEntityId: null,
  hintLinkDocumentId: null,
  hintPartnerId: null,
  hintText: null,
  humanTouched: false,
  id: '00000000-0000-4000-8000-000000000050',
  legalEntityId: null,
  origin: null,
  partnerId: null,
  payloadKind: 'file',
  receivedAt: '2026-09-16T08:00:00.000Z',
  routedAt: null,
  snoozedUntil: null,
  status: 'needs_review',
  updatedAt: '2026-09-16T08:00:00.000Z',
};

// jsdom ships no matchMedia, which Carbon reads on mount.
beforeEach(() => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    addEventListener: vi.fn(),
    addListener: vi.fn(),
    dispatchEvent: vi.fn(),
    matches: false,
    media: query,
    onchange: null,
    removeEventListener: vi.fn(),
    removeListener: vi.fn(),
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function acceptUploads() {
  return vi.fn(async (input: string) => {
    if (String(input).endsWith('/inbox/uploads')) {
      return Response.json({
        duplicateOfItemId: null,
        files: [],
        item: uploadedItem,
      });
    }
    return new Response(null, { status: 404 });
  });
}

function renderModal(
  overrides: Partial<ComponentProps<typeof UploadModal>> = {},
) {
  const onUploaded = vi.fn();
  render(
    <I18nProvider>
      <UploadModal
        initialFiles={[]}
        onClose={vi.fn()}
        onUploaded={onUploaded}
        organizationId={ORGANIZATION_ID}
        {...overrides}
      />
    </I18nProvider>,
  );
  return { onUploaded };
}

function addFiles(files: File[]) {
  fireEvent.change(
    screen.getByLabelText('Drag and drop files here or click to upload'),
    { target: { files } },
  );
}

describe('UploadModal', () => {
  it('uploads each added file once and ends every item complete', async () => {
    const fetchMock = acceptUploads();
    vi.stubGlobal('fetch', fetchMock);
    const { onUploaded } = renderModal();

    addFiles([
      new File(['a'], 'first.pdf', { type: 'application/pdf' }),
      new File(['b'], 'second.png', { type: 'image/png' }),
    ]);

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.filter((call) =>
          String(call[0]).endsWith('/inbox/uploads'),
        ),
      ).toHaveLength(2);
    });
    expect(await screen.findByText('first.pdf')).toBeVisible();
    expect(screen.getByText('second.png')).toBeVisible();
    // The status icon of a complete item carries the "Uploaded" description.
    await waitFor(() => {
      expect(screen.getAllByText('Uploaded')).toHaveLength(2);
    });
    expect(onUploaded).toHaveBeenCalledTimes(2);
  });

  it('marks a refused file invalid with the refusal sentence', async () => {
    const fetchMock = vi.fn(async (input: string) => {
      if (String(input).endsWith('/inbox/uploads')) {
        return new Response(null, { status: 413 });
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { onUploaded } = renderModal();

    addFiles([new File(['a'], 'huge.pdf', { type: 'application/pdf' })]);

    expect(
      await screen.findByText('Refused: above 25 MB or over the storage quota'),
    ).toBeVisible();
    expect(onUploaded).not.toHaveBeenCalled();
  });

  it('removes an item from the list when its close control is used', async () => {
    const fetchMock = vi.fn(async (input: string) => {
      if (String(input).endsWith('/inbox/uploads')) {
        return new Response(null, { status: 413 });
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderModal();

    addFiles([new File(['a'], 'huge.pdf', { type: 'application/pdf' })]);
    await screen.findByText('huge.pdf');

    // A refused item renders in the edit state, so its close button is present.
    fireEvent.click(screen.getByRole('button', { name: 'Remove - huge.pdf' }));
    await waitFor(() => {
      expect(screen.queryByText('huge.pdf')).toBeNull();
    });
  });

  it('uploads files it is opened with', async () => {
    const fetchMock = acceptUploads();
    vi.stubGlobal('fetch', fetchMock);
    renderModal({
      initialFiles: [
        new File(['a'], 'seeded.pdf', { type: 'application/pdf' }),
      ],
    });

    expect(await screen.findByText('seeded.pdf')).toBeVisible();
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some((call) =>
          String(call[0]).endsWith('/inbox/uploads'),
        ),
      ).toBe(true);
    });
  });
});
