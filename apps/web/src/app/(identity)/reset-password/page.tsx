import { cookies } from 'next/headers';

import {
  isValidResetCapability,
  resetCapabilityCookieName,
} from '../../../lib/auth/reset-capability';
import ResetPasswordForm from './reset-password-form';

export default async function ResetPasswordPage() {
  const capability = (await cookies()).get(resetCapabilityCookieName)?.value;

  return <ResetPasswordForm available={isValidResetCapability(capability)} />;
}
