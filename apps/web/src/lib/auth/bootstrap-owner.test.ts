import { describe, expect, it } from 'vitest';

import { resolveBootstrapState } from './bootstrap-owner.js';

describe('resolveBootstrapState', () => {
  it('creates a first owner only when no partial state exists', () => {
    expect(resolveBootstrapState({ hasOwner: false, user: null })).toBe(
      'create_user_and_organization',
    );
  });

  it('resumes only a verified global admin without membership', () => {
    expect(
      resolveBootstrapState({
        hasOwner: false,
        user: {
          emailVerified: true,
          hasMembership: false,
          id: 'user_1',
          role: 'admin',
        },
      }),
    ).toBe('resume_organization');
  });

  it('aborts existing and invalid partial owner states', () => {
    expect(resolveBootstrapState({ hasOwner: true, user: null })).toBe(
      'abort_existing_owner',
    );
    expect(
      resolveBootstrapState({
        hasOwner: false,
        user: {
          emailVerified: false,
          hasMembership: false,
          id: 'user_1',
          role: 'admin',
        },
      }),
    ).toBe('abort_partial_state');
  });
});
