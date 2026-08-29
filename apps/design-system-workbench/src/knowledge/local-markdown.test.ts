import { describe, expect, it } from 'vitest';

import { knowledgeDocumentSources } from '../foundations/knowledge-documents.js';
import { localKnowledgeHref } from './local-markdown.js';

describe('local knowledge Markdown links', () => {
  it('rewrites every local chapter and preserves its heading fragment', () => {
    for (const source of knowledgeDocumentSources) {
      const filename = source.source.split('/').at(-1);
      expect(localKnowledgeHref(`${filename}#local-heading`)).toBe(
        `/?path=/docs/${source.storyId}#local-heading`,
      );
    }
  });

  it('preserves external and same-document links', () => {
    expect(localKnowledgeHref('https://example.com/guide.md#section')).toBe(
      'https://example.com/guide.md#section',
    );
    expect(localKnowledgeHref('#local-heading')).toBe('#local-heading');
  });
});
