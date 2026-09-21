'use client';

import { Asleep, Light, Logout } from '@bap/design-system/icons';
import {
  Button,
  HeaderPanel,
  RadioButton,
  RadioButtonGroup,
  Switcher,
  SwitcherDivider,
  SwitcherItem,
} from '@bap/design-system/react';
import { themeModes, useThemeMode } from '@bap/design-system/theme';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { authClient } from '../../lib/auth/client';
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
        <div className={styles.menu!}>
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
          <p className={styles.about!}>{t('shell.help.about', { version })}</p>
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
