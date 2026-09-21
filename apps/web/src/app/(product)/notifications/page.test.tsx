import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getAuthPool: vi.fn(),
  listNotifications: vi.fn(),
  dismissNotificationAction: vi.fn(),
  markNotificationsReadAction: vi.fn(),
  redirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT');
  }),
  push: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('@bap/db/access', () => ({
  listNotifications: mocks.listNotifications,
}));
vi.mock('../../../lib/auth/server', () => ({
  getAuth: async () => ({
    api: {
      getSession: mocks.getSession,
    },
  }),
  getAuthPool: mocks.getAuthPool,
}));
vi.mock('../../../lib/notifications/actions', () => ({
  dismissNotificationAction: mocks.dismissNotificationAction,
  markNotificationsReadAction: mocks.markNotificationsReadAction,
}));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
  useRouter: () => ({
    push: mocks.push,
    refresh: mocks.refresh,
  }),
}));

import { I18nProvider } from '../../../i18n/client-provider';
import NotificationsPage from './page';

async function renderPage() {
  const ui = await NotificationsPage();
  return render(<I18nProvider>{ui}</I18nProvider>);
}

const sampleNotification = {
  id: '00000000-0000-4000-8000-000000000001',
  userId: 'user-1',
  kind: 'member.joined',
  title: 'Placeholder Member joined',
  body: 'Joined as member',
  href: '/workspaces',
  readAt: null,
  createdAt: new Date('2026-09-01T00:00:00.000Z'),
};

afterEach(cleanup);

describe('NotificationsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({
      user: { emailVerified: true, id: 'user-1' },
    });
    mocks.getAuthPool.mockResolvedValue({});
    mocks.listNotifications.mockResolvedValue([]);
    mocks.dismissNotificationAction.mockResolvedValue(undefined);
    mocks.markNotificationsReadAction.mockResolvedValue(undefined);
  });

  it('renders the notifications heading and each row', async () => {
    mocks.listNotifications.mockResolvedValue([sampleNotification]);

    await renderPage();

    expect(
      screen.getByRole('heading', { name: 'Notifications' }),
    ).toBeVisible();
    expect(screen.getByText('Placeholder Member joined')).toBeVisible();
    expect(screen.getByText('Joined as member')).toBeVisible();
  });

  it('dismisses a row through its overflow action', async () => {
    mocks.listNotifications.mockResolvedValue([sampleNotification]);

    await renderPage();

    const firstBodyRow = screen.getAllByRole('row')[1] as HTMLElement;
    fireEvent.click(within(firstBodyRow).getByRole('button'));
    fireEvent.click(screen.getByText('Dismiss'));

    expect(mocks.dismissNotificationAction).toHaveBeenCalledWith(
      sampleNotification.id,
    );
  });

  it('marks all read from the toolbar action', async () => {
    mocks.listNotifications.mockResolvedValue([sampleNotification]);

    await renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }));

    expect(mocks.markNotificationsReadAction).toHaveBeenCalled();
  });

  it('shows the empty state when there are no notifications', async () => {
    await renderPage();

    expect(screen.getByText('You have no notifications yet.')).toBeVisible();
  });

  it('redirects an unverified request before reading notifications', async () => {
    mocks.getSession.mockResolvedValue({ user: { emailVerified: false } });

    await expect(NotificationsPage()).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.redirect).toHaveBeenCalledWith('/sign-in');
    expect(mocks.listNotifications).not.toHaveBeenCalled();
  });
});
