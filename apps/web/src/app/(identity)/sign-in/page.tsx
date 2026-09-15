import { publicSignupEnabled } from '@bap/db/access';
import { Suspense } from 'react';

import { getAuthPool } from '../../../lib/auth/server';
import SignInForm from './sign-in-form';

async function isPublicSignUpEnabled(): Promise<boolean> {
  try {
    return await publicSignupEnabled(await getAuthPool());
  } catch {
    return false;
  }
}

export default async function SignInPage() {
  // The form reads the next parameter, which a prerender cannot know.
  return (
    <Suspense>
      <SignInForm publicSignupEnabled={await isPublicSignUpEnabled()} />
    </Suspense>
  );
}
