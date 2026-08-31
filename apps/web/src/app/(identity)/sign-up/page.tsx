import { publicSignupEnabled } from '@bap/db/access';

import { getAuthPool } from '../../../lib/auth/server';
import SignUpForm from './sign-up-form';

async function isPublicSignUpEnabled(): Promise<boolean> {
  try {
    return await publicSignupEnabled(await getAuthPool());
  } catch {
    return false;
  }
}

export default async function SignUpPage() {
  return <SignUpForm enabled={await isPublicSignUpEnabled()} />;
}
