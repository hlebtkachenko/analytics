import { describe, expect, it } from 'vitest';

import { curateJobFailure } from './job-failure.js';

describe('curateJobFailure', () => {
  it('keeps the error name and drops everything else', () => {
    const provider = new Error('Bad request');
    provider.name = 'AI_APICallError';
    // The AI SDK carries the sent prompt on the error, which pg-boss would serialize verbatim.
    Object.assign(provider, {
      requestBodyValues: { prompt: 'dataset alpha container' },
      responseBody: 'provider detail',
    });

    const curated = curateJobFailure(provider);

    expect(curated.message).toBe('The job failed with AI_APICallError.');
    expect(JSON.stringify(curated)).not.toContain('alpha container');
    expect(JSON.stringify({ ...curated })).not.toContain('provider detail');
  });

  it('names a thrown non-error safely', () => {
    expect(curateJobFailure('raw string').message).toBe(
      'The job failed with Error.',
    );
  });
});
