// The AI Assistant area is a placeholder header item with no route yet.
export const ASSISTANT_AREA_LABEL = 'AI Assistant';

// The rail's whole-app destinations, all real routes; icons live at the callsite.
export const railDestinations = [
  { href: '/access', labelKey: 'shell.nav.access', route: 'access' },
  {
    href: '/organizations',
    labelKey: 'shell.nav.organizations',
    route: 'organizations',
  },
  { href: '/datasets', labelKey: 'shell.nav.datasets', route: 'datasets' },
  { href: '/account', labelKey: 'shell.nav.account', route: 'account' },
] as const;

// The workspace section links shown when an organization is active.
export const workspaceSectionItems = [
  { labelKey: 'shell.nav.members', segment: 'members' },
  { labelKey: 'shell.nav.entities', segment: 'entities' },
  { labelKey: 'shell.nav.settings', segment: 'settings' },
] as const;

// Classifies the current path into the active rail destination id.
export function activeRoute(pathname: string): string | undefined {
  const first = pathname.split('/').filter(Boolean)[0];
  if (first === undefined) {
    return undefined;
  }
  if (first === 'access' || first === 'datasets' || first === 'account') {
    return first;
  }
  // Organizations and every workspace slug belong to the Organizations section.
  return 'organizations';
}
