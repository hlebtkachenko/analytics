// Resource JWTs are BFF-only and email changes are disabled.
export const disabledAuthPaths = new Set(['/change-email', '/token']);

export const resourceJwtConfiguration = {
  audience: 'bap-internal-services',
  lifetime: '5m',
} as const;
