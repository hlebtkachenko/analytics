import type { NotificationRow } from '@bap/db/access';
import { DesignSystemProvider } from '@bap/design-system/theme';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../../i18n/client-provider';
import { resources } from '../../i18n/resources';

const navigation = { pathname: '/account', segments: ['account'] as string[] };

vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSelectedLayoutSegments: () => navigation.segments,
}));

// The notification server actions are stubbed; this UI test never touches the auth pool.
const notificationActions = vi.hoisted(() => ({
  dismissAllNotificationsAction: vi.fn(() => Promise.resolve()),
  dismissNotificationAction: vi.fn(() => Promise.resolve()),
  markNotificationReadAction: vi.fn(() => Promise.resolve()),
  markNotificationsReadAction: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../lib/notifications/actions', () => notificationActions);

import { ActiveOrganization } from './active-organization';
import ProductShell from './product-shell';
import { railDestinations, workspaceSectionItems } from './product-navigation';

// The shell renders label keys, so the assertions read the same English the provider serves.
function englishFor(key: string): string {
  return key
    .split('.')
    .reduce<unknown>(
      (node, segment) => (node as Record<string, unknown>)[segment],
      resources['en-US'].translation,
    ) as string;
}

function stubMatchMedia(matches: boolean): void {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    addEventListener: vi.fn(),
    addListener: vi.fn(),
    dispatchEvent: vi.fn(),
    matches,
    media: query,
    onchange: null,
    removeEventListener: vi.fn(),
    removeListener: vi.fn(),
  }));
}

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  navigation.pathname = '/account';
  navigation.segments = ['account'];
  stubMatchMedia(true);
  globalThis.ResizeObserver =
    ResizeObserverStub as unknown as typeof ResizeObserver;
  for (const action of Object.values(notificationActions)) {
    action.mockClear();
  }
});

afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.carbonTheme;
});

const testUser = { email: 'ada@example.com', name: 'Ada Lovelace' } as const;

function renderShell(
  options: Readonly<{
    feedbackEmail?: string;
    invitationCount?: number;
    notifications?: readonly NotificationRow[];
    railPinned?: boolean;
    unreadCount?: number;
  }> = {},
) {
  return render(
    <DesignSystemProvider mode="light">
      <I18nProvider>
        <ProductShell
          feedbackEmail={options.feedbackEmail}
          invitationCount={options.invitationCount}
          notifications={options.notifications}
          railPinned={options.railPinned ?? false}
          unreadCount={options.unreadCount}
          user={testUser}
          version="1.2.3"
        >
          <p>Page body</p>
        </ProductShell>
      </I18nProvider>
    </DesignSystemProvider>,
  );
}

describe('ProductShell', () => {
  it('owns exactly one main content landmark and renders the page body', () => {
    const { container } = renderShell();

    expect(container.querySelectorAll('main#main-content')).toHaveLength(1);
    expect(screen.getByText('Page body')).toBeTruthy();
  });

  it('renders a skip link that targets the main content', () => {
    renderShell();

    const skip = screen.getByRole('link', { name: 'Skip to main content' });
    expect(skip.getAttribute('href')).toBe('#main-content');
  });

  it('renders the Afframe Analytics brand and no AI Assistant area', () => {
    renderShell();

    expect(screen.getByText('Afframe')).toBeTruthy();
    expect(screen.queryByText('AI Assistant')).toBeNull();
    expect(
      screen.getByRole('link', { name: /Afframe/ }).getAttribute('href'),
    ).toBe('/workspaces');
  });

  it('renders the six global header actions', () => {
    renderShell();

    for (const label of [
      'Search',
      'Notifications',
      'Help',
      'Settings',
      'Account',
      'Workspaces',
    ]) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
    }
  });

  it('shows an empty notifications panel and no badge when nothing is pending', () => {
    renderShell();

    const action = screen.getByRole('button', { name: 'Notifications' });
    expect(within(action).queryByText('2')).toBeNull();

    fireEvent.click(action);

    expect(screen.getByText('You have no notifications yet.')).toBeTruthy();
  });

  it('badges the notifications action and lists invitations when pending', () => {
    renderShell({ invitationCount: 2 });

    const action = screen.getByRole('button', { name: 'Notifications' });
    expect(within(action).getByText('2')).toBeTruthy();

    fireEvent.click(action);

    const link = screen.getByRole('link', {
      name: 'Workspace invitations (2 pending)',
    });
    expect(link.getAttribute('href')).toBe('/workspaces');
  });

  it('badges the notifications action with unread plus invitations', () => {
    renderShell({ invitationCount: 2, unreadCount: 3 });

    const action = screen.getByRole('button', { name: 'Notifications' });
    expect(within(action).getByText('5')).toBeTruthy();
  });

  it('renders notification rows, linking the ones that carry an href', () => {
    const notifications: NotificationRow[] = [
      {
        id: 'n1',
        userId: 'u1',
        kind: 'member.joined',
        title: 'Ada joined Acme Legal',
        body: null,
        href: '/acme-legal/members',
        readAt: null,
        createdAt: new Date('2026-09-20T10:00:00Z'),
      },
      {
        id: 'n2',
        userId: 'u1',
        kind: 'member.joined',
        title: 'A note without a link',
        body: null,
        href: null,
        readAt: new Date('2026-09-19T10:00:00Z'),
        createdAt: new Date('2026-09-19T10:00:00Z'),
      },
    ];

    renderShell({ notifications });

    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }));

    const link = screen.getByRole('link', { name: /Ada joined Acme Legal/ });
    expect(link.getAttribute('href')).toBe('/acme-legal/members');
    expect(screen.getByText('A note without a link')).toBeTruthy();
    expect(
      screen.queryByRole('link', { name: /A note without a link/ }),
    ).toBeNull();
  });

  it('does not mark notifications read when the panel opens', () => {
    const notifications: NotificationRow[] = [
      {
        id: 'n1',
        userId: 'u1',
        kind: 'member.joined',
        title: 'Ada joined Acme Legal',
        body: null,
        href: null,
        readAt: null,
        createdAt: new Date(),
      },
    ];

    renderShell({ notifications, unreadCount: 1 });

    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }));

    expect(
      notificationActions.markNotificationsReadAction,
    ).not.toHaveBeenCalled();
  });

  it('marks all read from the panel header action', () => {
    const notifications: NotificationRow[] = [
      {
        id: 'n1',
        userId: 'u1',
        kind: 'member.joined',
        title: 'Ada joined Acme Legal',
        body: null,
        href: null,
        readAt: null,
        createdAt: new Date(),
      },
    ];

    renderShell({ notifications, unreadCount: 1 });

    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }));

    expect(notificationActions.markNotificationsReadAction).toHaveBeenCalled();
  });

  it('dismisses a single notification from its row action', () => {
    const notifications: NotificationRow[] = [
      {
        id: 'n1',
        userId: 'u1',
        kind: 'member.joined',
        title: 'Ada joined Acme Legal',
        body: null,
        href: null,
        readAt: null,
        createdAt: new Date(),
      },
    ];

    renderShell({ notifications });

    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(notificationActions.dismissNotificationAction).toHaveBeenCalledWith(
      'n1',
    );
  });

  it('groups notifications by day and marks unread rows', () => {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const notifications: NotificationRow[] = [
      {
        id: 'n1',
        userId: 'u1',
        kind: 'member.joined',
        title: 'A fresh unread note',
        body: 'With a body',
        href: null,
        readAt: null,
        createdAt: now,
      },
      {
        id: 'n2',
        userId: 'u1',
        kind: 'system',
        title: 'An older read note',
        body: null,
        href: null,
        readAt: yesterday,
        createdAt: yesterday,
      },
    ];

    const { container } = renderShell({ notifications, unreadCount: 1 });

    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }));

    expect(screen.getByText('Today')).toBeTruthy();
    expect(screen.getByText('Yesterday')).toBeTruthy();
    expect(screen.getByText('With a body')).toBeTruthy();
    expect(
      container.querySelector('[class*="notificationUnread"]'),
    ).toBeTruthy();
  });

  it('shows the settings panel with an account settings link', () => {
    renderShell();

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));

    expect(screen.getByRole('heading', { name: 'Settings' })).toBeTruthy();
    expect(
      screen
        .getByRole('link', { name: 'Account settings' })
        .getAttribute('href'),
    ).toBe('/account');
  });

  it('closes an open panel on a pointer press outside the header', () => {
    renderShell();

    fireEvent.click(screen.getByRole('button', { name: 'Help' }));
    expect(screen.getByRole('link', { name: 'Documentation' })).toBeTruthy();

    fireEvent.pointerDown(screen.getByText('Page body'));

    expect(screen.queryByRole('link', { name: 'Documentation' })).toBeNull();
  });

  it('shows the application version in the help panel', () => {
    renderShell();

    fireEvent.click(screen.getByRole('button', { name: 'Help' }));

    expect(screen.getByText('Version 1.2.3')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Documentation' })).toBeTruthy();
    expect(screen.getByRole('link', { name: "What's new" })).toBeTruthy();
  });

  it('hides the feedback link when no feedback address is configured', () => {
    renderShell();

    fireEvent.click(screen.getByRole('button', { name: 'Help' }));

    expect(screen.queryByRole('link', { name: 'Send feedback' })).toBeNull();
  });

  it('shows a feedback mailto link when a feedback address is configured', () => {
    renderShell({ feedbackEmail: 'feedback@example.com' });

    fireEvent.click(screen.getByRole('button', { name: 'Help' }));

    const link = screen.getByRole('link', { name: 'Send feedback' });
    expect(link.getAttribute('href')).toBe('mailto:feedback@example.com');
  });

  it('renders exactly the rail destinations from the navigation array', () => {
    renderShell();

    const rail = screen.getByRole('navigation', { name: 'Side navigation' });
    const links = within(rail).getAllByRole('link');

    expect(links).toHaveLength(railDestinations.length);
    railDestinations.forEach((destination, index) => {
      expect(links[index]!.textContent).toContain(
        englishFor(destination.labelKey),
      );
      expect(links[index]!.getAttribute('href')).toBe(destination.href);
    });
  });

  it('shows the account identity and links in the account panel', () => {
    renderShell();

    fireEvent.click(screen.getByRole('button', { name: 'Account' }));

    expect(screen.getByText('Ada Lovelace')).toBeTruthy();
    expect(screen.getByText('ada@example.com')).toBeTruthy();
    const profile = screen.getByRole('link', { name: 'My profile' });
    expect(profile.getAttribute('href')).toBe('/account');
    expect(
      screen
        .getByRole('link', { name: 'Security and sessions' })
        .getAttribute('href'),
    ).toBe('/account/security');
    expect(
      screen.getByRole('link', { name: 'Preferences' }).getAttribute('href'),
    ).toBe('/account/preferences');
    // No active workspace, so no role line is shown.
    expect(screen.queryByText('Owner')).toBeNull();
  });

  it('shows the workspace role in the account panel when a workspace is active', () => {
    render(
      <DesignSystemProvider mode="light">
        <I18nProvider>
          <ProductShell railPinned={false} user={testUser} version="1.2.3">
            <ActiveOrganization
              id="org-1"
              name="Acme Legal"
              role="owner"
              slug="acme-legal"
            />
            <p>Page body</p>
          </ProductShell>
        </I18nProvider>
      </DesignSystemProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Account' }));

    expect(screen.getByText('Owner')).toBeTruthy();
  });

  it('lists the active organization as a tabbable switcher item', () => {
    render(
      <DesignSystemProvider mode="light">
        <I18nProvider>
          <ProductShell railPinned={false} user={testUser} version="1.2.3">
            <ActiveOrganization
              id="org-1"
              name="Acme Legal"
              role="owner"
              slug="acme-legal"
            />
            <p>Page body</p>
          </ProductShell>
        </I18nProvider>
      </DesignSystemProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Workspaces' }));

    const switcher = screen.getByRole('list', { name: 'Workspaces' });
    const item = within(switcher).getByRole('link', { name: 'Acme Legal' });
    expect(item.getAttribute('href')).toBe('/acme-legal');
    expect(item.tabIndex).toBe(0);
    expect(
      within(switcher).getByRole('link', { name: 'Manage workspaces' })
        .tabIndex,
    ).toBe(0);
  });

  it('shows the workspace section for the active organization', () => {
    render(
      <DesignSystemProvider mode="light">
        <I18nProvider>
          <ProductShell railPinned={false} user={testUser} version="1.2.3">
            <ActiveOrganization
              id="org-1"
              name="Acme Legal"
              role="owner"
              slug="acme-legal"
            />
            <p>Page body</p>
          </ProductShell>
        </I18nProvider>
      </DesignSystemProvider>,
    );

    const rail = screen.getByRole('navigation', { name: 'Side navigation' });
    expect(within(rail).getByText('Acme Legal')).toBeTruthy();

    const links = within(rail).getAllByRole('link');
    const workspaceLinks = links.slice(railDestinations.length);

    expect(workspaceLinks).toHaveLength(workspaceSectionItems.length);
    workspaceSectionItems.forEach((item, index) => {
      expect(workspaceLinks[index]!.textContent).toContain(
        englishFor(item.labelKey),
      );
      expect(workspaceLinks[index]!.getAttribute('href')).toBe(
        `/acme-legal/${item.segment}`,
      );
    });
  });
});
