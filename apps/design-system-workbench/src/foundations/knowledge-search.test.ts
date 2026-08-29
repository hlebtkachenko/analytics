import { describe, expect, it } from 'vitest';

import { searchEntries, type KnowledgeDocument } from './knowledge-search.js';

const documents: readonly KnowledgeDocument[] = [
  {
    body: '# First chapter',
    id: 'first-chapter',
    sections: [
      {
        anchor: 'accessibility',
        body: 'First accessibility section.',
        title: 'Accessibility',
        url: '/?path=/docs/first#accessibility',
      },
      {
        anchor: 'accessibility',
        body: 'Repeated accessibility section.',
        title: 'Accessibility',
        url: '/?path=/docs/first#accessibility',
      },
    ],
    summary: 'First chapter summary.',
    title: 'First chapter',
    url: '/?path=/docs/first',
  },
  {
    body: '# Second chapter',
    id: 'second-chapter',
    sections: [
      {
        anchor: 'accessibility',
        body: 'Second accessibility section.',
        title: 'Accessibility',
        url: '/?path=/docs/second#accessibility',
      },
    ],
    summary: 'Second chapter summary.',
    title: 'Second chapter',
    url: '/?path=/docs/second',
  },
];

describe('searchEntries', () => {
  it('keeps duplicate headings globally unique without changing anchors', () => {
    const entries = searchEntries(documents);

    expect(entries.map((entry) => entry.id)).toEqual([
      'first-chapter',
      'first-chapter--accessibility',
      'first-chapter--accessibility--2',
      'second-chapter',
      'second-chapter--accessibility',
    ]);
    expect(entries.map((entry) => entry.url)).toEqual([
      '/?path=/docs/first',
      '/?path=/docs/first#accessibility',
      '/?path=/docs/first#accessibility',
      '/?path=/docs/second',
      '/?path=/docs/second#accessibility',
    ]);
  });
});
