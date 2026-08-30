import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../../i18n/client-provider';
import { DatasetChat } from './dataset-chat';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const datasetId = '00000000-0000-4000-8000-000000000001';

function renderChat() {
  return render(
    <I18nProvider>
      <DatasetChat
        datasetId={datasetId}
        datasetName="Placeholder dataset"
        organizationId="organization_1"
      />
    </I18nProvider>,
  );
}

function askQuestion(question: string) {
  fireEvent.change(screen.getByLabelText('Message'), {
    target: { value: question },
  });
  fireEvent.submit(screen.getByRole('form', { name: 'Assistant' }));
}

describe('DatasetChat', () => {
  it('names the organization and the open dataset in the chat request and streams the answer', async () => {
    const sent: Array<{ body: string; path: string }> = [];
    const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
      sent.push({ body: String(init?.body ?? ''), path });
      return new Response(
        'data: {"type":"text-start","id":"0"}\n\ndata: {"type":"text-delta","id":"0","delta":"An answer."}\n\ndata: [DONE]\n\n',
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    renderChat();
    askQuestion('What does this page show?');

    await waitFor(() => {
      expect(sent).toHaveLength(1);
    });
    expect(sent[0]?.path).toBe('/api/chat');
    expect(JSON.parse(sent[0]?.body ?? '')).toEqual({
      datasetId,
      messages: [{ content: 'What does this page show?', role: 'user' }],
      organizationId: 'organization_1',
    });
    expect(await screen.findByText('An answer.')).toBeVisible();
  });

  it('reports a refused turn without showing an answer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 403 })),
    );

    renderChat();
    askQuestion('What does this page show?');

    expect(
      await screen.findByText('The assistant could not answer.'),
    ).toBeVisible();
  });
});
