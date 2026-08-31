import { resolveOrganizationRoute } from '@bap/db/access';
import { headers } from 'next/headers';
import { cache } from 'react';

import { getAuth, getAuthPool } from '../auth/server';
import { organizationSlugSchema } from './slug';

export const resolveOrganizationRouteForRequest = cache(
  async (organizationSlug: string) => {
    const slug = organizationSlugSchema.safeParse(organizationSlug);
    if (!slug.success) {
      return null;
    }

    try {
      const auth = await getAuth();
      const session = await auth.api.getSession({ headers: await headers() });
      if (!session?.user.emailVerified) {
        return null;
      }

      return await resolveOrganizationRoute(await getAuthPool(), {
        organizationSlug: slug.data,
        subjectId: session.user.id,
      });
    } catch {
      return null;
    }
  },
);
