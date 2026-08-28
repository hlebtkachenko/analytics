export const disabledAuthPaths = new Set([
  '/token',
  '/sign-up/email',
  '/request-password-reset',
  '/reset-password',
  '/send-verification-email',
  '/verify-email',
  '/organization/accept-invitation',
  '/organization/cancel-invitation',
  '/organization/get-invitation',
  '/organization/invite-member',
  '/organization/list-invitations',
  '/organization/list-user-invitations',
  '/organization/reject-invitation',
]);

export const resourceJwtConfiguration = {
  audience: 'bap-internal-services',
  lifetime: '5m',
} as const;
