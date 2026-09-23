import type { Route } from 'next';
import { redirect } from 'next/navigation';

import { withOrganization } from '../../../../lib/documents/client';

type InboxSettingsRedirectProperties = Readonly<{
  searchParams: Promise<{ organization?: string | string[] }>;
}>;

// The routing defaults live on the rules page; this route forwards, so an old link keeps its organization.
export default async function InboxSettingsRedirectPage({
  searchParams,
}: InboxSettingsRedirectProperties) {
  const { organization } = await searchParams;
  const slug = Array.isArray(organization) ? organization[0] : organization;
  redirect(withOrganization('/inbox/rules', slug ?? '') as Route);
}
