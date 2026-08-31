// Resource JWTs are BFF-only, email changes are disabled, and deletion has no mail callback.
export const disabledAuthPaths = new Set([
  '/admin/impersonate-user',
  '/admin/remove-user',
  '/admin/stop-impersonating',
  '/change-email',
  '/delete-user/callback',
  '/token',
]);

export const resourceJwtConfiguration = {
  audience: 'bap-internal-services',
  lifetime: '5m',
} as const;
