import { describe, expect, it } from 'vitest';

import {
  knowledgeDocumentSources,
  loadKnowledgeDocuments,
} from './knowledge-documents.js';

describe('offline knowledge documents', () => {
  it('indexes every handbook chapter and coverage artifact', async () => {
    expect(knowledgeDocumentSources).toHaveLength(16);
    expect(knowledgeDocumentSources.map((source) => source.id)).toEqual([
      '01-orientation',
      '02-designing',
      '03-developing',
      '04-foundations',
      '05-components',
      '06-patterns',
      '07-carbon-for-ai',
      '08-data-visualization',
      '09-component-definition-of-done',
      '10-accessibility-i18n-content',
      '11-contribution-upgrades',
      'coverage-react-mdx',
      'coverage-react-stories',
      'coverage-website',
      'readme',
      'source-coverage',
    ]);
    const documents = await loadKnowledgeDocuments();
    expect(documents).toHaveLength(16);
    expect(documents.every((document) => document.sections.length > 0)).toBe(
      true,
    );
    expect(
      documents.find((document) => document.id === 'source-coverage')?.body,
    ).toContain('Coverage totals');
    expect(
      documents
        .find((document) => document.id === '04-foundations')
        ?.sections.some((section) => section.title === 'Semantic color'),
    ).toBe(true);
    for (const document of documents) {
      const anchors = document.sections.map((section) => section.anchor);
      expect(new Set(anchors).size).toBe(anchors.length);
    }
  });
});
