import { describe, expect, it } from 'vitest';

import { buildTrail, collapseTrail } from './breadcrumb-trail';

describe('buildTrail', () => {
  it('drops route group segments and labels a known module', () => {
    expect(buildTrail(['(product)', 'documents'])).toEqual([
      { current: true, href: '/documents', label: 'Documents' },
    ]);
  });

  it('labels the notifications module rather than its raw segment', () => {
    expect(buildTrail(['(product)', 'notifications'])).toEqual([
      { current: true, href: '/notifications', label: 'Notifications' },
    ]);
  });

  it('scopes a child label by its parent module', () => {
    expect(buildTrail(['documents', 'new']).at(-1)?.label).toBe('New document');
    expect(buildTrail(['workspaces', 'new']).at(-1)?.label).toBe(
      'Create workspace',
    );
  });

  it('scopes the account children by the account module', () => {
    expect(buildTrail(['(product)', 'account', 'security'])).toEqual([
      { current: false, href: '/account', label: 'Account' },
      { current: true, href: '/account/security', label: 'Security' },
    ]);
    expect(buildTrail(['account', 'preferences']).at(-1)?.label).toBe(
      'Preferences',
    );
    expect(buildTrail(['account', 'access']).at(-1)?.label).toBe('Access');
  });

  it('names the documents analytics child rather than falling back to Document', () => {
    expect(buildTrail(['(product)', 'documents', 'analytics'])).toEqual([
      { current: false, href: '/documents', label: 'Documents' },
      { current: true, href: '/documents/analytics', label: 'Analytics' },
    ]);
  });

  it('labels an unknown document child by kind rather than by identifier', () => {
    expect(
      buildTrail(['documents', '00000000-0000-4000-8000-000000000010']),
    ).toEqual([
      { current: false, href: '/documents', label: 'Documents' },
      {
        current: true,
        href: '/documents/00000000-0000-4000-8000-000000000010',
        label: 'Document',
      },
    ]);
  });

  it('opens a workspace slug route with the organization it belongs to', () => {
    expect(
      buildTrail(['placeholder-holding', 'settings'], {
        name: 'Placeholder Holding',
        slug: 'placeholder-holding',
      }),
    ).toEqual([
      { current: false, href: '/workspaces', label: 'Workspaces' },
      {
        current: false,
        href: '/placeholder-holding',
        label: 'Placeholder Holding',
      },
      {
        current: true,
        href: '/placeholder-holding/settings',
        label: 'Settings',
      },
    ]);
  });
});

describe('collapseTrail', () => {
  it('keeps the first crumb and the last two once the trail is too long', () => {
    const crumbs = ['a', 'b', 'c', 'd', 'e', 'f'].map((label) => ({
      current: false,
      href: `/${label}`,
      label,
    }));

    expect(collapseTrail(crumbs)).toEqual({
      head: [crumbs[0]],
      hidden: [crumbs[1], crumbs[2], crumbs[3]],
      tail: [crumbs[4], crumbs[5]],
    });
  });
});
