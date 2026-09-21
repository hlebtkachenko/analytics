'use client';

import type { NotificationRow } from '@bap/db/access';
import { Asleep, Close, Light, Logout } from '@bap/design-system/icons';
import {
  Button,
  HeaderPanel,
  IconButton,
  RadioButton,
  RadioButtonGroup,
  Switcher,
  SwitcherDivider,
  SwitcherItem,
} from '@bap/design-system/react';
import { themeModes, useThemeMode } from '@bap/design-system/theme';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { authClient } from '../../lib/auth/client';
import {
  dismissAllNotificationsAction,
  dismissNotificationAction,
  markNotificationReadAction,
  markNotificationsReadAction,
} from '../../lib/notifications/actions';
import {
  NotificationSeverityIcon,
  notificationSeverity,
} from '../../lib/notifications/severity';
import {
  themeCookieName,
  writePreferenceCookie,
} from '../../lib/preferences/cookies';
import type { ActiveOrganizationValue } from './active-organization';
import styles from './header-panels.module.scss';

export const organizationsSchema = z.array(
  z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    slug: z.string().min(1),
  }),
);

type PanelProperties = Readonly<{ expanded: boolean }>;

// Two initials from a name, else one from the email; a real avatar label.
function deriveInitials(name: string, email: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return `${words[0]![0]!}${words[1]![0]!}`.toUpperCase();
  }
  if (words.length === 1 && words[0]!.length > 0) {
    return words[0]!.slice(0, 2).toUpperCase();
  }
  return (email.trim()[0] ?? '?').toUpperCase();
}

export function SwitcherPanel({
  activeOrganization,
  expanded,
}: PanelProperties &
  Readonly<{ activeOrganization?: ActiveOrganizationValue }>) {
  const [organizations, setOrganizations] = useState<
    z.infer<typeof organizationsSchema>
  >([]);

  useEffect(() => {
    if (!expanded) {
      return;
    }
    const controller = new AbortController();
    void fetch('/api/auth/organization/list', {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : []))
      .then((payload) => setOrganizations(organizationsSchema.parse(payload)))
      .catch(() => {});
    return () => controller.abort();
  }, [expanded]);

  // Always reflect the current workspace even before the list loads.
  const list =
    organizations.length > 0
      ? organizations
      : activeOrganization
        ? [
            {
              id: activeOrganization.id,
              name: activeOrganization.name,
              slug: activeOrganization.slug,
            },
          ]
        : [];

  return (
    <HeaderPanel expanded={expanded}>
      {expanded ? (
        // Only an expanded Switcher gives its items a tab stop.
        <Switcher aria-label="Workspaces" expanded>
          {list.map((organization) => (
            <SwitcherItem
              aria-label={organization.name}
              href={`/${organization.slug}`}
              isSelected={organization.slug === activeOrganization?.slug}
              key={organization.id}
            >
              {organization.name}
            </SwitcherItem>
          ))}
          <SwitcherDivider />
          <SwitcherItem aria-label="Create workspace" href="/workspaces/new">
            Create workspace
          </SwitcherItem>
          <SwitcherItem aria-label="Manage workspaces" href="/workspaces">
            Manage workspaces
          </SwitcherItem>
        </Switcher>
      ) : null}
    </HeaderPanel>
  );
}

export function HelpPanel({
  expanded,
  feedbackEmail,
  version,
}: PanelProperties &
  Readonly<{ feedbackEmail?: string | undefined; version: string }>) {
  const { t } = useTranslation();

  return (
    <HeaderPanel expanded={expanded}>
      {expanded ? (
        <div className={styles.panel!}>
          <a
            className={styles.link!}
            href="https://github.com/hlebtkachenko/analytics/tree/main/docs"
            rel="noreferrer"
            target="_blank"
          >
            {t('shell.help.documentation')}
          </a>
          {feedbackEmail === undefined || feedbackEmail.length === 0 ? null : (
            <a className={styles.link!} href={`mailto:${feedbackEmail}`}>
              {t('shell.help.feedback')}
            </a>
          )}
          <a
            className={styles.link!}
            href="https://github.com/hlebtkachenko/analytics/releases"
            rel="noreferrer"
            target="_blank"
          >
            {t('shell.help.whatsNew')}
          </a>
          <p className={styles.identityMeta!}>
            {t('shell.help.about', { version })}
          </p>
        </div>
      ) : null}
    </HeaderPanel>
  );
}

// Relative time in the largest sensible unit, e.g. "2 hours ago" / "yesterday".
const relativeTimeUnits: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31_536_000],
  ['month', 2_592_000],
  ['week', 604_800],
  ['day', 86_400],
  ['hour', 3600],
  ['minute', 60],
  ['second', 1],
];

function formatRelativeTime(value: Date, now: Date): string {
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const seconds = Math.round((value.getTime() - now.getTime()) / 1000);
  for (const [unit, unitSeconds] of relativeTimeUnits) {
    if (Math.abs(seconds) >= unitSeconds || unit === 'second') {
      return formatter.format(Math.round(seconds / unitSeconds), unit);
    }
  }
  return formatter.format(0, 'second');
}

// Local midnight, so notifications group by calendar day.
function startOfDay(value: Date): number {
  return new Date(
    value.getFullYear(),
    value.getMonth(),
    value.getDate(),
  ).getTime();
}

type NotificationGroup = Readonly<{
  items: readonly NotificationRow[];
  key: number;
  label: string;
}>;

// Group by calendar day, newest first, labelling Today / Yesterday / a date.
function groupByDay(
  notifications: readonly NotificationRow[],
  now: Date,
  t: (key: string) => string,
): NotificationGroup[] {
  const sorted = [...notifications].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  );
  const today = startOfDay(now);
  const groups: { items: NotificationRow[]; key: number; label: string }[] = [];
  for (const notification of sorted) {
    const key = startOfDay(notification.createdAt);
    let group = groups.find((candidate) => candidate.key === key);
    if (!group) {
      const dayDelta = Math.round((today - key) / 86_400_000);
      const label =
        dayDelta === 0
          ? t('shell.notifications.today')
          : dayDelta === 1
            ? t('shell.notifications.yesterday')
            : notification.createdAt.toLocaleDateString();
      group = { items: [], key, label };
      groups.push(group);
    }
    group.items.push(notification);
  }
  return groups;
}

export function NotificationsPanel({
  expanded,
  invitationCount,
  notifications,
  unreadCount,
}: PanelProperties &
  Readonly<{
    invitationCount: number;
    notifications: readonly NotificationRow[];
    unreadCount: number;
  }>) {
  const { t } = useTranslation();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const now = new Date();
  const groups = groupByDay(notifications, now, t);

  // Run a refreshing action inside a transition so its button is briefly disabled.
  function runAction(action: () => Promise<void>): void {
    startTransition(() => {
      void action().then(() => router.refresh());
    });
  }

  return (
    <HeaderPanel className={styles.notificationsPanel!} expanded={expanded}>
      {expanded ? (
        <div className={styles.panel!}>
          <div className={styles.notificationsHeader!}>
            <h2 className={styles.panelHeading!}>
              {t('shell.notifications.title')}
            </h2>
            <div className={styles.notificationsActions!}>
              <Button
                disabled={unreadCount === 0 || isPending}
                kind="ghost"
                onClick={() => runAction(markNotificationsReadAction)}
                size="sm"
                type="button"
              >
                {t('shell.notifications.markAllRead')}
              </Button>
              <Button
                disabled={notifications.length === 0 || isPending}
                kind="ghost"
                onClick={() => runAction(dismissAllNotificationsAction)}
                size="sm"
                type="button"
              >
                {t('shell.notifications.dismissAll')}
              </Button>
            </div>
          </div>
          {invitationCount > 0 ? (
            <Link className={styles.link!} href="/workspaces">
              {t('shell.invitations.action', { count: invitationCount })}
            </Link>
          ) : null}
          {groups.map((group) => (
            <div className={styles.dayGroup!} key={group.key}>
              <p className={styles.dayHeader!}>{group.label}</p>
              {group.items.map((notification) => {
                const unread = notification.readAt === null;
                const title = (
                  <span className={styles.notificationTitle!}>
                    {notification.title}
                  </span>
                );
                return (
                  <div
                    className={
                      unread
                        ? `${styles.notification!} ${styles.notificationUnread!}`
                        : styles.notification!
                    }
                    key={notification.id}
                  >
                    <NotificationSeverityIcon
                      severity={notificationSeverity(notification.kind)}
                    />
                    <div className={styles.notificationText!}>
                      {notification.href === null ? (
                        title
                      ) : (
                        <Link
                          className={styles.notificationLink!}
                          href={{ pathname: notification.href }}
                          onClick={() =>
                            void markNotificationReadAction(
                              notification.id,
                            ).then(() => router.refresh())
                          }
                        >
                          {title}
                        </Link>
                      )}
                      {notification.body === null ||
                      notification.body.length === 0 ? null : (
                        <span className={styles.notificationBody!}>
                          {notification.body}
                        </span>
                      )}
                      <span className={styles.notificationTime!}>
                        {formatRelativeTime(notification.createdAt, now)}
                      </span>
                    </div>
                    <IconButton
                      disabled={isPending}
                      kind="ghost"
                      label={t('shell.notifications.dismiss')}
                      onClick={() =>
                        runAction(() =>
                          dismissNotificationAction(notification.id),
                        )
                      }
                      size="sm"
                    >
                      <Close aria-hidden="true" size={16} />
                    </IconButton>
                  </div>
                );
              })}
            </div>
          ))}
          {invitationCount === 0 && notifications.length === 0 ? (
            <p className={styles.muted!}>{t('shell.notifications.empty')}</p>
          ) : null}
          <Link className={styles.viewAll!} href="/notifications">
            {t('shell.notifications.viewAll')}
          </Link>
        </div>
      ) : null}
    </HeaderPanel>
  );
}

export function SettingsPanel({ expanded }: PanelProperties) {
  const { t } = useTranslation();

  return (
    <HeaderPanel expanded={expanded}>
      {expanded ? (
        <div className={styles.panel!}>
          <h2 className={styles.panelHeading!}>{t('shell.settings.title')}</h2>
          <p className={styles.muted!}>{t('shell.settings.description')}</p>
          <Link className={styles.link!} href="/account">
            {t('shell.settings.accountSettings')}
          </Link>
        </div>
      ) : null}
    </HeaderPanel>
  );
}

export function AccountPanel({
  activeOrganization,
  expanded,
  user,
}: PanelProperties &
  Readonly<{
    activeOrganization?: ActiveOrganizationValue;
    user: Readonly<{ email: string; name: string }>;
  }>) {
  const router = useRouter();
  const { t } = useTranslation();
  const { mode, setMode } = useThemeMode();

  async function signOut(): Promise<void> {
    await authClient.signOut();
    router.replace('/sign-in');
    router.refresh();
  }

  const role = activeOrganization?.role;
  const roleLabels: Readonly<Record<string, string>> = {
    admin: t('shell.roles.admin'),
    member: t('shell.roles.member'),
    owner: t('shell.roles.owner'),
  };

  return (
    <HeaderPanel expanded={expanded}>
      {expanded ? (
        <div className={styles.account!}>
          <div className={styles.identity!}>
            <span aria-hidden="true" className={styles.initials!}>
              {deriveInitials(user.name, user.email)}
            </span>
            <div>
              <p className={styles.identityName!}>{user.name}</p>
              <p className={styles.identityMeta!}>{user.email}</p>
              {role === undefined ? null : (
                <p className={styles.identityMeta!}>
                  {roleLabels[role] ?? role}
                </p>
              )}
            </div>
          </div>
          <div className={styles.section!}>
            <Link className={styles.link!} href="/account">
              {t('shell.account.profile')}
            </Link>
            <Link className={styles.link!} href="/account/security">
              {t('shell.account.security')}
            </Link>
            <Link className={styles.link!} href="/account/preferences">
              {t('shell.account.preferences')}
            </Link>
          </div>
          <div className={styles.section!}>
            <RadioButtonGroup
              legendText={t('shell.account.themeTitle')}
              name="theme-mode"
              onChange={(value) => {
                const next = value as (typeof themeModes)[number];
                setMode(next);
                writePreferenceCookie(themeCookieName, next);
              }}
              orientation="vertical"
              valueSelected={mode}
            >
              <RadioButton
                labelText={
                  <span className={styles.option!}>
                    <Light aria-hidden="true" focusable="false" size={16} />
                    {t('shell.account.themeLight')}
                  </span>
                }
                value="light"
              />
              <RadioButton
                labelText={
                  <span className={styles.option!}>
                    <Asleep aria-hidden="true" focusable="false" size={16} />
                    {t('shell.account.themeDark')}
                  </span>
                }
                value="dark"
              />
              <RadioButton
                labelText={t('shell.account.themeSystem')}
                value="system"
              />
            </RadioButtonGroup>
          </div>
          <div className={styles.section!}>
            <Button
              kind="secondary"
              onClick={() => void signOut()}
              renderIcon={Logout}
              type="button"
            >
              {t('common.signOut')}
            </Button>
          </div>
        </div>
      ) : null}
    </HeaderPanel>
  );
}
