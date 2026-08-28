export type BootstrapState =
  | 'abort_existing_owner'
  | 'abort_partial_state'
  | 'create_user_and_organization'
  | 'resume_organization';

export type OwnerBootstrapRecord = Readonly<{
  hasOwner: boolean;
  user: Readonly<{
    emailVerified: boolean;
    hasMembership: boolean;
    id: string;
    role: string;
  }> | null;
}>;

export function resolveBootstrapState(
  record: OwnerBootstrapRecord,
): BootstrapState {
  if (record.hasOwner) {
    return 'abort_existing_owner';
  }
  if (!record.user) {
    return 'create_user_and_organization';
  }
  if (
    record.user.role === 'admin' &&
    record.user.emailVerified &&
    !record.user.hasMembership
  ) {
    return 'resume_organization';
  }
  return 'abort_partial_state';
}
