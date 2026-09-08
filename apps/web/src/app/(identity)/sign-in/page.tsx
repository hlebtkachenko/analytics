import { publicSignupEnabled } from '@bap/db/access';

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
  return <SignInForm publicSignupEnabled={await isPublicSignUpEnabled()} />;
}
