import { DataSet, Document, Email, UserAvatar } from '@bap/design-system/icons';
import type { ComponentType } from 'react';

// Carbon icon components accept a Carbon artboard size and nothing the rail sets.
type RailIcon = ComponentType<Readonly<{ size?: number }>>;

export type RailDestination = Readonly<{
  href: string;
  icon: RailIcon;
  labelKey: string;
  route: string;
}>;

export type WorkspaceSectionItem = Readonly<{
  labelKey: string;
  segment: string;
}>;

// The rail's whole-app destinations, all real routes, rendered straight from this array.
export const railDestinations: readonly RailDestination[] = [
  {
    href: '/datasets',
    icon: DataSet,
    labelKey: 'shell.nav.datasets',
    route: 'datasets',
  },
  { href: '/inbox', icon: Email, labelKey: 'shell.nav.inbox', route: 'inbox' },
  {
    href: '/documents',
    icon: Document,
    labelKey: 'shell.nav.documents',
    route: 'documents',
  },
  {
    href: '/account',
    icon: UserAvatar,
    labelKey: 'shell.nav.account',
    route: 'account',
  },
];

// The workspace section links shown when an organization is active.
export const workspaceSectionItems: readonly WorkspaceSectionItem[] = [
  { labelKey: 'shell.nav.members', segment: 'members' },
  { labelKey: 'shell.nav.entities', segment: 'entities' },
  { labelKey: 'shell.nav.settings', segment: 'settings' },
];

// Classifies the current path into the active rail destination id.
export function activeRoute(pathname: string): string | undefined {
  const first = pathname.split('/').filter(Boolean)[0];
  if (first === undefined) {
    return undefined;
  }
  const destination = railDestinations.find(
    (candidate) => candidate.route === first,
  );
  // Every workspace slug belongs to the workspaces section.
  return destination?.route ?? 'workspaces';
}
