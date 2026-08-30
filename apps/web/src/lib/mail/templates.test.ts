import { describe, expect, it } from 'vitest';

import { mailTemplates } from './templates.ts';

const params = {
  to: 'user@bap.invalid',
  url: 'https://bap.invalid/sign-in/abc123',
};

describe('mailTemplates', () => {
  it('renders a non-empty magic-link mail containing the url', () => {
    const result = mailTemplates.magicLink(params);

    expect(result.subject.length).toBeGreaterThan(0);
    expect(result.text).toContain(params.url);
  });

  it('renders a non-empty password-reset mail containing the url', () => {
    const result = mailTemplates.passwordReset(params);

    expect(result.subject.length).toBeGreaterThan(0);
    expect(result.text).toContain(params.url);
  });

  it('renders a non-empty verification mail containing the url', () => {
    const result = mailTemplates.emailVerification(params);

    expect(result.subject.length).toBeGreaterThan(0);
    expect(result.text).toContain(params.url);
  });

  it('renders an invitation mail naming the organization and the url', () => {
    const result = mailTemplates.organizationInvitation({
      ...params,
      organization: 'Organization 1',
    });

    expect(result.subject).toContain('Organization 1');
    expect(result.text).toContain(params.url);
  });
});
