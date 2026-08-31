// Resource JWTs are BFF-only, membership is invite-only, and email changes are disabled.
export const disabledAuthPaths = new Set([
  '/change-email',
  '/sign-up/email',
  '/token',
]);

export const resourceJwtConfiguration = {
  audience: 'bap-internal-services',
  lifetime: '5m',
} as const;
