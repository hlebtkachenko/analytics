'use client';

import { Asleep, Light, Logout, UserAvatar } from '@bap/design-system/icons';
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
import { z } from 'zod';

import { authClient } from '../../lib/auth/client';
import {
  themeCookieName,
  writePreferenceCookie,
} from '../../lib/preferences/cookies';
import type { ActiveOrganizationValue } from './active-organization';
import styles from './header-panels.module.scss';
import { useToast } from './toast';

const organizationsSchema = z.array(
  z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    slug: z.string().min(1),
  }),
);

type PanelProperties = Readonly<{ expanded: boolean }>;

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
              id: activeOrganization.slug,
              name: activeOrganization.name,
              slug: activeOrganization.slug,
            },
          ]
        : [];

  return (
    <HeaderPanel aria-label="Workspaces" expanded={expanded}>
      {expanded ? (
        <Switcher aria-label="Workspaces">
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
          <SwitcherItem
            aria-label="Create organization"
            href="/organizations/new"
          >
            Create organization
          </SwitcherItem>
          <SwitcherItem aria-label="Manage organizations" href="/organizations">
            Manage organizations
          </SwitcherItem>
        </Switcher>
      ) : null}
    </HeaderPanel>
  );
}

export function NotificationsPanel({ expanded }: PanelProperties) {
  return (
    <HeaderPanel aria-label="Notifications" expanded={expanded}>
      {expanded ? (
        <div className={styles.panel!}>
          <h2 className={styles.panelHeading!}>Notifications</h2>
          <p className={styles.muted!}>You have no notifications yet.</p>
        </div>
      ) : null}
    </HeaderPanel>
  );
}

export function HelpPanel({ expanded }: PanelProperties) {
  const { notify } = useToast();
  const soon = (title: string) => () =>
    notify({
      subtitle: `${title} is not available yet.`,
      title: 'Coming soon',
    });

  return (
    <HeaderPanel aria-label="Help" expanded={expanded}>
      {expanded ? (
        <div className={styles.menu!}>
          <Button kind="ghost" onClick={soon('Documentation')}>
            Documentation
          </Button>
          <Button kind="ghost" onClick={soon('Send feedback')}>
            Send feedback
          </Button>
          <Button kind="ghost" onClick={soon("What's new")}>
            What&apos;s new
          </Button>
          <Button kind="ghost" onClick={soon('About')}>
            About
          </Button>
        </div>
      ) : null}
    </HeaderPanel>
  );
}

export function SettingsPanel({ expanded }: PanelProperties) {
  return (
    <HeaderPanel aria-label="Settings" expanded={expanded}>
      {expanded ? (
        <div className={styles.panel!}>
          <h2 className={styles.panelHeading!}>Settings</h2>
          <p className={styles.muted!}>
            Application preferences arrive with the first product module.
          </p>
          <Link className={styles.link!} href="/account">
            Account settings
          </Link>
        </div>
      ) : null}
    </HeaderPanel>
  );
}

const modeLabels: Readonly<Record<(typeof themeModes)[number], string>> = {
  dark: 'Dark',
  light: 'Light',
  system: 'System',
};

export function AccountPanel({ expanded }: PanelProperties) {
  const router = useRouter();
  const { mode, setMode } = useThemeMode();

  async function signOut(): Promise<void> {
    await authClient.signOut();
    router.replace('/sign-in');
    router.refresh();
  }

  return (
    <HeaderPanel aria-label="Account" expanded={expanded}>
      {expanded ? (
        <div className={styles.account!}>
          <div className={styles.identity!}>
            <UserAvatar aria-hidden="true" focusable="false" size={32} />
            <div>
              <p className={styles.identityName!}>Your account</p>
              <p className={styles.identityMeta!}>
                Manage your profile and preferences
              </p>
            </div>
          </div>
          <div className={styles.section!}>
            <Link className={styles.link!} href="/account">
              My profile
            </Link>
            <Link className={styles.link!} href="/account">
              Account settings
            </Link>
            <Link className={styles.link!} href="/account">
              Security and sessions
            </Link>
          </div>
          <div className={styles.section!}>
            <div className={styles.appearance!}>
              <Light aria-hidden="true" focusable="false" size={16} />
              <Asleep aria-hidden="true" focusable="false" size={16} />
            </div>
            <RadioButtonGroup
              legendText="Appearance"
              name="theme-mode"
              onChange={(value) => {
                const next = value as (typeof themeModes)[number];
                setMode(next);
                writePreferenceCookie(themeCookieName, next);
              }}
              orientation="vertical"
              valueSelected={mode}
            >
              {themeModes.map((option) => (
                <RadioButton
                  key={option}
                  labelText={modeLabels[option]}
                  value={option}
                />
              ))}
            </RadioButtonGroup>
          </div>
          <div className={styles.section!}>
            <Button
              kind="secondary"
              onClick={() => void signOut()}
              renderIcon={Logout}
              type="button"
            >
              Sign out
            </Button>
          </div>
        </div>
      ) : null}
    </HeaderPanel>
  );
}
