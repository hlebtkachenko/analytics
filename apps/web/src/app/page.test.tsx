import { beforeEach, describe, expect, it, vi } from 'vitest';

import HomePage from './page';

const mocks = vi.hoisted(() => ({
  redirect: vi.fn(),
}));

vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));

describe('HomePage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('always redirects to the organization index', () => {
    HomePage();

    expect(mocks.redirect).toHaveBeenCalledWith('/organizations');
  });
});
