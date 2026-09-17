import { describe, expect, it, vi } from 'vitest';

import AccessRedirectPage from './page';

const mocks = vi.hoisted(() => ({ redirect: vi.fn() }));

vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));

describe('AccessRedirectPage', () => {
  it('forwards to the account access diagnostic', () => {
    AccessRedirectPage();

    expect(mocks.redirect).toHaveBeenCalledWith('/account/access');
  });
});
