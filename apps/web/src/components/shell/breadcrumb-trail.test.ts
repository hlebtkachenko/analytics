import { describe, expect, it } from 'vitest';

import { buildTrail, collapseTrail } from './breadcrumb-trail';

// A stand-in translator: a mapped key proves the trail translated it, anything
// else reads as missing, so a workspace name reaching it would be visible.
const navigationLabels: Readonly<Record<string, string>> = {
  'shell.nav.account': 'Account',
  'shell.nav.accountAccess': 'Access',
  'shell.nav.accountPreferences': 'Preferences',
  'shell.nav.accountSecurity': 'Security',
  'shell.nav.documents': 'Documents',
  'shell.nav.documentsAnalytics': 'Analytics',
  'shell.nav.documentsNew': 'New document',
  'shell.nav.inbox': 'Inbox',
  'shell.nav.inboxChannels': 'Sources',
  'shell.nav.inboxItem': 'Item',
  'shell.nav.inboxRules': 'Rules',
  'shell.nav.notifications': 'Notifications',
  'shell.nav.settings': 'Settings',
  'shell.nav.singleDocument': 'Document',
  'shell.nav.workspaces': 'Workspaces',
  'shell.nav.workspacesNew': 'Create workspace',
};

function translate(key: string): string {
  return navigationLabels[key] ?? `missing:${key}`;
}

describe('buildTrail', () => {
  it('drops route group segments and labels a known module', () => {
    expect(
      buildTrail(['(product)', 'documents'], undefined, translate),
    ).toEqual([{ current: true, href: '/documents', label: 'Documents' }]);
  });

  it('labels the notifications module rather than its raw segment', () => {
    expect(
      buildTrail(['(product)', 'notifications'], undefined, translate),
    ).toEqual([
      {
        current: true,
        href: '/notifications',
        label: 'Notifications',
      },
    ]);
  });

  it('scopes a child label by its parent module', () => {
    expect(
      buildTrail(['documents', 'new'], undefined, translate).at(-1)?.label,
    ).toBe('New document');
    expect(
      buildTrail(['workspaces', 'new'], undefined, translate).at(-1)?.label,
    ).toBe('Create workspace');
  });

  it('scopes the account children by the account module', () => {
    expect(
      buildTrail(['(product)', 'account', 'security'], undefined, translate),
    ).toEqual([
      { current: false, href: '/account', label: 'Account' },
      {
        current: true,
        href: '/account/security',
        label: 'Security',
      },
    ]);
    expect(
      buildTrail(['account', 'preferences'], undefined, translate).at(-1)
        ?.label,
    ).toBe('Preferences');
    expect(
      buildTrail(['account', 'access'], undefined, translate).at(-1)?.label,
    ).toBe('Access');
  });

  it('names the inbox channels child rather than falling back to Item', () => {
    expect(
      buildTrail(['(product)', 'inbox', 'channels'], undefined, translate),
    ).toEqual([
      { current: false, href: '/inbox', label: 'Inbox' },
      {
        current: true,
        href: '/inbox/channels',
        label: 'Sources',
      },
    ]);
  });

  it('names the inbox rules child rather than falling back to Item', () => {
    expect(
      buildTrail(['(product)', 'inbox', 'rules'], undefined, translate),
    ).toEqual([
      { current: false, href: '/inbox', label: 'Inbox' },
      { current: true, href: '/inbox/rules', label: 'Rules' },
    ]);
  });

  it('names the documents analytics child rather than falling back to Document', () => {
    expect(
      buildTrail(['(product)', 'documents', 'analytics'], undefined, translate),
    ).toEqual([
      { current: false, href: '/documents', label: 'Documents' },
      {
        current: true,
        href: '/documents/analytics',
        label: 'Analytics',
      },
    ]);
  });

  it('labels an unknown document child by kind rather than by identifier', () => {
    expect(
      buildTrail(
        ['documents', '00000000-0000-4000-8000-000000000010'],
        undefined,
        translate,
      ),
    ).toEqual([
      { current: false, href: '/documents', label: 'Documents' },
      {
        current: true,
        href: '/documents/00000000-0000-4000-8000-000000000010',
        label: 'Document',
      },
    ]);
  });

  it('labels an inbox item by kind rather than by identifier', () => {
    expect(
      buildTrail(
        ['(product)', 'inbox', '00000000-0000-4000-8000-000000000050'],
        undefined,
        translate,
      ),
    ).toEqual([
      { current: false, href: '/inbox', label: 'Inbox' },
      {
        current: true,
        href: '/inbox/00000000-0000-4000-8000-000000000050',
        label: 'Item',
      },
    ]);
  });

  it('opens a workspace slug route with the organization it belongs to', () => {
    expect(
      buildTrail(
        ['placeholder-holding', 'settings'],
        { name: 'Placeholder Holding', slug: 'placeholder-holding' },
        translate,
      ),
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
