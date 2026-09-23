import { describe, expect, it, vi } from 'vitest';

import InboxSettingsRedirectPage from './page';

const mocks = vi.hoisted(() => ({ redirect: vi.fn() }));

vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));

describe('InboxSettingsRedirectPage', () => {
  it('forwards to the rules page and keeps the organization', async () => {
    await InboxSettingsRedirectPage({
      searchParams: Promise.resolve({ organization: ['organization-1', 'x'] }),
    });

    expect(mocks.redirect).toHaveBeenLastCalledWith(
      '/inbox/rules?organization=organization-1',
    );
  });

  it('forwards to the rules page without an organization', async () => {
    await InboxSettingsRedirectPage({ searchParams: Promise.resolve({}) });

    expect(mocks.redirect).toHaveBeenLastCalledWith('/inbox/rules');
  });
});
