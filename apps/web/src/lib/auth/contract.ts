// Resource JWTs are BFF-only, email changes are disabled, and deletion has no mail callback.
export const disabledAuthPaths = new Set([
  '/admin/impersonate-user',
  '/admin/remove-user',
  '/admin/stop-impersonating',
  '/change-email',
  '/delete-user/callback',
  '/organization/delete',
  '/organization/get-active-member',
  // Membership removal and self-leave are replaced by member status: a membership is deactivated, never deleted.
  '/organization/leave',
  '/organization/remove-member',
  '/organization/set-active',
  '/token',
]);

export const resourceJwtConfiguration = {
  audience: 'bap-internal-services',
  lifetime: '5m',
} as const;
