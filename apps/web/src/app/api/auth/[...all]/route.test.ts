import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';

import { GET } from './route';

describe('Better Auth route exposure', () => {
  it('does not expose browser resource-token retrieval or disabled mail flows', async () => {
    const token = await GET(
      new NextRequest('https://bap.invalid/api/auth/token'),
    );
    const signUp = await GET(
      new NextRequest('https://bap.invalid/api/auth/sign-up/email'),
    );
    const invitation = await GET(
      new NextRequest(
        'https://bap.invalid/api/auth/organization/accept-invitation',
      ),
    );
    const resetCallback = await GET(
      new NextRequest(
        'https://bap.invalid/api/auth/reset-password/synthetic-token',
      ),
    );

    expect(token.status).toBe(404);
    expect(signUp.status).toBe(404);
    expect(invitation.status).toBe(404);
    expect(resetCallback.status).toBe(404);
  });
});
