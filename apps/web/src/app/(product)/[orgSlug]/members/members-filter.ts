// Pure membership filtering and row-action decisions, split out so they can be
// unit tested without driving the Carbon MultiSelect through jsdom.

export type MemberScope =
  | Readonly<{ mode: 'all' }>
  | Readonly<{ legalEntityIds: readonly string[]; mode: 'restricted' }>;

export type FilterableMember = Readonly<{
  role: string;
  status: string;
  userId: string;
}>;

export type MemberFilterSelection = Readonly<{
  entities: readonly string[];
  roles: readonly string[];
  statuses: readonly string[];
}>;

export type MemberActionCapabilities = Readonly<{
  callerIsOwner: boolean;
  canManageEntityAccess: boolean;
  canManageMembers: boolean;
  currentUserId: string | null;
  scopeEditorAvailable: boolean;
}>;

// A member passes when it matches every non-empty filter category. An entity
// filter matches when the member's scope covers any selected entity.
export function memberMatchesFilters(
  member: FilterableMember,
  selection: MemberFilterSelection,
  scopes: ReadonlyMap<string, MemberScope>,
): boolean {
  if (
    selection.statuses.length > 0 &&
    !selection.statuses.includes(member.status)
  ) {
    return false;
  }
  if (selection.roles.length > 0 && !selection.roles.includes(member.role)) {
    return false;
  }
  if (selection.entities.length > 0) {
    const scope = scopes.get(member.userId);
    const covered =
      scope === undefined ||
      scope.mode === 'all' ||
      selection.entities.some((id) => scope.legalEntityIds.includes(id));
    if (!covered) {
      return false;
    }
  }
  return true;
}

// The ordered row-action ids available for a member given the caller's
// capabilities. Removing self is the settings flow, so it is never offered here.
export function memberRowActionIds(
  member: FilterableMember,
  capabilities: MemberActionCapabilities,
): string[] {
  const ids: string[] = [];
  if (capabilities.canManageMembers) {
    ids.push('change-role');
  }
  // Only the sitting owner may hand ownership to another active, non-owner member.
  if (
    capabilities.callerIsOwner &&
    member.role !== 'owner' &&
    member.status === 'active'
  ) {
    ids.push('transfer-ownership');
  }
  // The API answers 409 for an owner target, so the owner is always all entities.
  if (
    capabilities.canManageEntityAccess &&
    capabilities.scopeEditorAvailable &&
    member.role !== 'owner'
  ) {
    ids.push('edit-scope');
  }
  if (
    capabilities.canManageMembers &&
    member.userId !== capabilities.currentUserId
  ) {
    ids.push(
      member.status === 'active' ? 'remove-member' : 'reactivate-member',
    );
  }
  return ids;
}
