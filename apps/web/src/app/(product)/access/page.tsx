import { redirect } from 'next/navigation';

// The access diagnostic now lives under the account area; this route only forwards.
export default function AccessRedirectPage() {
  redirect('/account/access');
}
