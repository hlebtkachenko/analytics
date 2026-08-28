import { describe, expect, it } from 'vitest';

import { GET } from './route';

describe('GET /health', () => {
  it('returns an ok status', async () => {
    const response = GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'ok' });
  });
});
