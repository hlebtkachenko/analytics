'use client';

import { DataGrid } from '@bap/design-system/blocks';
import type { GridColumn, GridRow } from '@bap/design-system/blocks';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useTranslation } from 'react-i18next';

import {
  dismissNotificationAction,
  markNotificationsReadAction,
} from '../../../lib/notifications/actions';
import {
  NotificationSeverityIcon,
  notificationSeverity,
} from '../../../lib/notifications/severity';
import styles from './notifications-view.module.scss';

export type NotificationItem = Readonly<{
  id: string;
  kind: string;
  title: string;
  body: string | null;
  href: string | null;
  created: string;
  read: boolean;
}>;

type NotificationsViewProperties = Readonly<{
  notifications: readonly NotificationItem[];
}>;

// The single locale is en-US, so the date format is pinned to it.
const dateFormat = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' });

export default function NotificationsView({
  notifications,
}: NotificationsViewProperties) {
  const { t } = useTranslation();
  const router = useRouter();

  const columns: readonly GridColumn[] = [
    {
      header: t('notifications.columnMessage'),
      key: 'title',
      renderCell: (row) => (
        <div className={styles.message}>
          <NotificationSeverityIcon
            severity={notificationSeverity(String(row.kind))}
          />
          <div className={styles.text}>
            <span className={styles.title}>{String(row.title)}</span>
            {typeof row.body === 'string' && row.body.length > 0 ? (
              <span className={styles.body}>{row.body}</span>
            ) : null}
          </div>
        </div>
      ),
    },
    {
      header: t('notifications.columnDate'),
      key: 'created',
      renderCell: (row) => dateFormat.format(new Date(String(row.created))),
    },
  ];

  const hasUnread = notifications.some((notification) => !notification.read);

  const rows: readonly GridRow[] = notifications.map((notification) => ({
    id: notification.id,
    kind: notification.kind,
    title: notification.title,
    body: notification.body,
    href: notification.href,
    created: notification.created,
  }));

  return (
    <DataGrid
      columns={columns}
      emptyLabel={t('notifications.empty')}
      onRowClick={(row) => {
        if (typeof row.href === 'string' && row.href.length > 0) {
          router.push(row.href as Route);
        }
      }}
      rowActions={(row) => [
        {
          id: 'dismiss',
          isDelete: true,
          label: t('shell.notifications.dismiss'),
          onClick: () => {
            void dismissNotificationAction(String(row.id)).then(() => {
              router.refresh();
            });
          },
        },
      ]}
      rows={rows}
      size="sm"
      state={rows.length === 0 ? 'empty' : 'ready'}
      title={t('notifications.title')}
      toolbarActions={[
        {
          disabled: !hasUnread,
          id: 'mark-all-read',
          kind: 'ghost',
          label: t('shell.notifications.markAllRead'),
          onClick: () => {
            void markNotificationsReadAction().then(() => {
              router.refresh();
            });
          },
        },
      ]}
    />
  );
}
