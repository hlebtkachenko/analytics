import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test } from 'vitest';
import { page } from 'vitest/browser';

import { loadKnowledgeDocuments } from './knowledge-documents.js';
import { KnowledgeSearch } from './knowledge-search.js';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

test('links assistive-technology guidance to its unique local section', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      createElement(KnowledgeSearch, {
        documents: await loadKnowledgeDocuments(),
      }),
    );
  });

  try {
    await act(async () => {
      await page
        .getByRole('searchbox', { name: 'Search local knowledge' })
        .fill('assistive technology results');
    });
    await expect
      .poll(
        () =>
          host.querySelector<HTMLAnchorElement>(
            'a[href$="#documentation-accessibility"]',
          )?.textContent,
      )
      .toContain('Documentation accessibility');
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
