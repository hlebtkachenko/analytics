import { describe, expect, it } from 'vitest';

import {
  type MemberScope,
  memberMatchesFilters,
  memberRowActionIds,
} from './members-filter';

const owner = { role: 'owner', status: 'active', userId: 'user-owner' };
const member = { role: 'member', status: 'active', userId: 'user-member' };
const inactive = { role: 'admin', status: 'inactive', userId: 'user-admin' };

const scopes = new Map<string, MemberScope>([
  ['user-member', { legalEntityIds: ['entity-a'], mode: 'restricted' }],
]);

const noFilters = { entities: [], roles: [], statuses: [] };

describe('memberMatchesFilters', () => {
  it('keeps every member when no category is selected', () => {
    expect(memberMatchesFilters(owner, noFilters, scopes)).toBe(true);
    expect(memberMatchesFilters(inactive, noFilters, scopes)).toBe(true);
  });

  it('filters by status', () => {
    const active = { ...noFilters, statuses: ['active'] };
    expect(memberMatchesFilters(owner, active, scopes)).toBe(true);
    expect(memberMatchesFilters(inactive, active, scopes)).toBe(false);
  });

  it('filters by role', () => {
    const owners = { ...noFilters, roles: ['owner'] };
    expect(memberMatchesFilters(owner, owners, scopes)).toBe(true);
    expect(memberMatchesFilters(member, owners, scopes)).toBe(false);
  });

  it('matches an entity filter against a restricted scope', () => {
    const entityA = { ...noFilters, entities: ['entity-a'] };
    const entityB = { ...noFilters, entities: ['entity-b'] };
    expect(memberMatchesFilters(member, entityA, scopes)).toBe(true);
    expect(memberMatchesFilters(member, entityB, scopes)).toBe(false);
  });

  it('treats a missing or all scope as covering every entity', () => {
    const entityB = { ...noFilters, entities: ['entity-b'] };
    // owner has no scope entry, so it is unrestricted.
    expect(memberMatchesFilters(owner, entityB, scopes)).toBe(true);
    const allScope = new Map<string, MemberScope>([
      ['user-member', { mode: 'all' }],
    ]);
    expect(memberMatchesFilters(member, entityB, allScope)).toBe(true);
  });

  it('requires every selected category to pass', () => {
    const selection = { entities: [], roles: ['member'], statuses: ['active'] };
    expect(memberMatchesFilters(member, selection, scopes)).toBe(true);
    expect(memberMatchesFilters(owner, selection, scopes)).toBe(false);
  });
});

describe('memberRowActionIds', () => {
  const owned = {
    callerIsOwner: true,
    canManageEntityAccess: true,
    canManageMembers: true,
    currentUserId: 'user-caller',
    scopeEditorAvailable: true,
  };

  it('offers remove for an active member and reactivate for an inactive one', () => {
    expect(memberRowActionIds(member, owned)).toContain('remove-member');
    expect(memberRowActionIds(inactive, owned)).toContain('reactivate-member');
    expect(memberRowActionIds(inactive, owned)).not.toContain('remove-member');
  });

  it('never offers entity scope on the owner row', () => {
    expect(memberRowActionIds(owner, owned)).not.toContain('edit-scope');
    expect(memberRowActionIds(member, owned)).toContain('edit-scope');
  });

  it('never offers remove or reactivate on the caller row', () => {
    const self = { ...member, userId: 'user-caller' };
    const ids = memberRowActionIds(self, owned);
    expect(ids).not.toContain('remove-member');
    expect(ids).not.toContain('reactivate-member');
    expect(ids).toContain('change-role');
  });

  it('offers nothing to manage without the capability', () => {
    const readOnly = {
      ...owned,
      callerIsOwner: false,
      canManageEntityAccess: false,
      canManageMembers: false,
    };
    expect(memberRowActionIds(member, readOnly)).toEqual([]);
  });

  it('offers ownership transfer only to the owner and only for an active non-owner', () => {
    expect(memberRowActionIds(member, owned)).toContain('transfer-ownership');
    // The owner never transfers ownership to the owner row.
    expect(memberRowActionIds(owner, owned)).not.toContain(
      'transfer-ownership',
    );
    // An inactive member cannot receive ownership.
    expect(memberRowActionIds(inactive, owned)).not.toContain(
      'transfer-ownership',
    );
    // A non-owner caller never sees the action.
    const admin = { ...owned, callerIsOwner: false };
    expect(memberRowActionIds(member, admin)).not.toContain(
      'transfer-ownership',
    );
  });
});
