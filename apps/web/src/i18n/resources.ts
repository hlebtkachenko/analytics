export const supportedLanguages = ['en-US'] as const;

export type SupportedLanguage = (typeof supportedLanguages)[number];

export const resources = {
  'en-US': {
    translation: {
      access: {
        actions: 'Available actions',
        denied: 'You do not have access to this organization.',
        empty: 'No organizations are available for this account.',
        error: 'Organization access could not be checked.',
        loading: 'Checking organization access.',
        manageGrants: 'Manage data grants',
        manageMembers: 'Manage members',
        organization: 'Organization',
        reporting: 'Reporting API role',
        application: 'Application API role',
        selectOrganization: 'Select an organization',
        title: 'Organization access',
        uploadData: 'Upload data',
        useAi: 'Ask the assistant',
      },
      auth: {
        email: 'Email address',
        password: 'Password',
        signIn: 'Sign in',
        signInFailed: 'Sign-in failed. Check your credentials and try again.',
        title: 'Sign in to BAP',
      },
      common: {
        signOut: 'Sign out',
      },
      invitation: {
        accept: 'Accept invitation',
        acceptFailed: 'The invitation could not be accepted.',
        error: 'This invitation is no longer valid.',
        loading: 'Checking the invitation.',
        organization: 'Organization',
        role: 'Role',
        summary: 'You were invited to join an organization on BAP.',
        title: 'Organization invitation',
      },
      reference: {
        title: 'Carbon design system',
      },
    },
  },
} as const;
