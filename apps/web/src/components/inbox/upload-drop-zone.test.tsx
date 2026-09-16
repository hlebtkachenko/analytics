import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../../i18n/client-provider';
import UploadDropZone from './upload-drop-zone';

const ITEM_ID = '00000000-0000-4000-8000-000000000050';
const EARLIER_ITEM_ID = '00000000-0000-4000-8000-000000000051';

const inboxItem = {
  assigneeId: null,
  channelKind: 'upload',
  confidence: null,
  createdAt: '2026-09-16T08:00:00.000Z',
  datasetId: null,
  decidedByKind: null,
  decidedByUserId: null,
  detectedType: null,
  documentId: null,
  duplicateOfItemId: null,
  hintKind: null,
  hintLegalEntityId: null,
  hintLinkDocumentId: null,
  hintPartnerId: null,
  hintText: null,
  id: ITEM_ID,
  legalEntityId: null,
  partnerId: null,
  payloadKind: 'file',
  receivedAt: '2026-09-16T08:00:00.000Z',
  routedAt: null,
  snoozedUntil: null,
  status: 'received',
  updatedAt: '2026-09-16T08:00:00.000Z',
};

function upload(duplicateOfItemId: string | null) {
  return Response.json(
    {
      duplicateOfItemId,
      files: [],
      item:
        duplicateOfItemId === null
          ? inboxItem
          : { ...inboxItem, duplicateOfItemId, status: 'discarded' },
    },
    { status: 201 },
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('UploadDropZone', () => {
  it('sends one request per file in order and reports each outcome', async () => {
    const bodies: FormData[] = [];
    const answers = [
      upload(null),
      upload(EARLIER_ITEM_ID),
      new Response(null, { status: 413 }),
    ];
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => {
      bodies.push(init?.body as FormData);
      return answers.shift()!;
    });
    vi.stubGlobal('fetch', fetchMock);
    const onUploaded = vi.fn();

    render(
      <I18nProvider>
        <UploadDropZone
          itemHref={(itemId) => `/inbox/${itemId}`}
          onUploaded={onUploaded}
          organizationId="organization_1"
        />
      </I18nProvider>,
    );

    const input = screen.getByLabelText('Drop files here or choose files', {
      selector: 'input',
    });
    fireEvent.change(input, {
      target: {
        files: [
          new File(['a'], 'first.pdf', { type: 'application/pdf' }),
          new File(['b'], 'second.pdf', { type: 'application/pdf' }),
          new File(['c'], 'third.bin'),
        ],
      },
    });

    expect(
      await screen.findByRole('link', { name: 'Received' }),
    ).toHaveAttribute('href', `/inbox/${ITEM_ID}`);
    expect(
      await screen.findByRole('link', { name: 'Duplicate of an earlier item' }),
    ).toHaveAttribute('href', `/inbox/${EARLIER_ITEM_ID}`);
    expect(
      await screen.findByText('Refused: above 25 MB or over the storage quota'),
    ).toBeVisible();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(
      fetchMock.mock.calls.every(
        (call) =>
          call[0] ===
          '/api/bff/application/organizations/organization_1/inbox/uploads',
      ),
    ).toBe(true);
    expect(bodies.map((body) => (body.get('file') as File).name)).toEqual([
      'first.pdf',
      'second.pdf',
      'third.bin',
    ]);
    expect(onUploaded).toHaveBeenCalledTimes(1);
  });
});
