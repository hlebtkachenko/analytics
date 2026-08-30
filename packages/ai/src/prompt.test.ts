import { describe, expect, it } from 'vitest';

import { assemblePrompt } from './prompt.js';

describe('assemblePrompt', () => {
  it('renders titled sections in order', () => {
    expect(
      assemblePrompt([
        { content: 'Answer briefly.', title: 'Task' },
        { content: 'The report is quarterly.', title: 'Context' },
      ]),
    ).toBe(
      '## Task\n\nAnswer briefly.\n\n## Context\n\nThe report is quarterly.',
    );
  });

  it('drops sections without content and trims the rest', () => {
    expect(
      assemblePrompt([
        { content: '  Answer briefly.  ', title: '  Task  ' },
        { content: '   ', title: 'Context' },
      ]),
    ).toBe('## Task\n\nAnswer briefly.');
  });

  it('renders an untitled section as plain content', () => {
    expect(assemblePrompt([{ content: 'Answer briefly.', title: '' }])).toBe(
      'Answer briefly.',
    );
  });

  it('returns an empty prompt for no usable sections', () => {
    expect(assemblePrompt([])).toBe('');
  });
});
