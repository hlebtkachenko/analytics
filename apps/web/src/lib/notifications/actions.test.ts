import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  deleteAllNotifications: vi.fn(),
  deleteNotification: vi.fn(),
  getSession: vi.fn(),
  markNotificationRead: vi.fn(),
  markNotificationsRead: vi.fn(),
  pool: {},
}));

vi.mock('@bap/db/access', () => ({
  deleteAllNotifications: mocks.deleteAllNotifications,
  deleteNotification: mocks.deleteNotification,
  markNotificationRead: mocks.markNotificationRead,
  markNotificationsRead: mocks.markNotificationsRead,
}));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('../auth/server', () => ({
  getAuth: async () => ({ api: { getSession: mocks.getSession } }),
  getAuthPool: async () => mocks.pool,
}));

import {
  dismissAllNotificationsAction,
  dismissNotificationAction,
  markNotificationReadAction,
} from './actions';

const validId = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('markNotificationReadAction', () => {
  it('rejects a non-uuid id before any session lookup or query', async () => {
    await expect(markNotificationReadAction('not-a-uuid')).rejects.toThrow();
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(mocks.markNotificationRead).not.toHaveBeenCalled();
  });

  it('marks nothing for an unverified or absent session', async () => {
    mocks.getSession.mockResolvedValue(null);

    await expect(markNotificationReadAction(validId)).resolves.toBeUndefined();
    expect(mocks.markNotificationRead).not.toHaveBeenCalled();
  });

  it('marks the notification read for a verified caller', async () => {
    mocks.getSession.mockResolvedValue({
      user: { id: 'user-1', emailVerified: true },
    });

    await markNotificationReadAction(validId);
    expect(mocks.markNotificationRead).toHaveBeenCalledWith(
      mocks.pool,
      'user-1',
      validId,
    );
  });
});

describe('dismissNotificationAction', () => {
  it('rejects a non-uuid id before any session lookup or query', async () => {
    await expect(dismissNotificationAction('not-a-uuid')).rejects.toThrow();
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(mocks.deleteNotification).not.toHaveBeenCalled();
  });

  it('deletes nothing for an unverified or absent session', async () => {
    mocks.getSession.mockResolvedValue(null);

    await expect(dismissNotificationAction(validId)).resolves.toBeUndefined();
    expect(mocks.deleteNotification).not.toHaveBeenCalled();
  });

  it('deletes the notification for a verified caller', async () => {
    mocks.getSession.mockResolvedValue({
      user: { id: 'user-1', emailVerified: true },
    });

    await dismissNotificationAction(validId);
    expect(mocks.deleteNotification).toHaveBeenCalledWith(
      mocks.pool,
      'user-1',
      validId,
    );
  });
});

describe('dismissAllNotificationsAction', () => {
  it('deletes nothing for an unverified or absent session', async () => {
    mocks.getSession.mockResolvedValue(null);

    await expect(dismissAllNotificationsAction()).resolves.toBeUndefined();
    expect(mocks.deleteAllNotifications).not.toHaveBeenCalled();
  });

  it('deletes every notification for a verified caller', async () => {
    mocks.getSession.mockResolvedValue({
      user: { id: 'user-1', emailVerified: true },
    });

    await dismissAllNotificationsAction();
    expect(mocks.deleteAllNotifications).toHaveBeenCalledWith(
      mocks.pool,
      'user-1',
    );
  });
});
