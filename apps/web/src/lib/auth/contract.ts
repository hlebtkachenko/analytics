// These two stay disabled forever: resource JWTs are BFF-only and membership is invite-only.
export const disabledAuthPaths = new Set(['/token', '/sign-up/email']);

export const resourceJwtConfiguration = {
  audience: 'bap-internal-services',
  lifetime: '5m',
} as const;
