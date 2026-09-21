import { describe, expect, it } from 'vitest';

import { workspaceMatchesFilters } from './workspace-filter';

const admin = { role: 'admin', status: 'active' };
const member = { role: 'member', status: 'active' };
const inactive = { role: 'member', status: 'inactive' };

const noFilters = { roles: [], statuses: [] };

describe('workspaceMatchesFilters', () => {
  it('keeps every workspace when no category is selected', () => {
    expect(workspaceMatchesFilters(admin, noFilters)).toBe(true);
    expect(workspaceMatchesFilters(inactive, noFilters)).toBe(true);
  });

  it('filters by role', () => {
    const admins = { ...noFilters, roles: ['admin'] };
    expect(workspaceMatchesFilters(admin, admins)).toBe(true);
    expect(workspaceMatchesFilters(member, admins)).toBe(false);
  });

  it('filters by status', () => {
    const active = { ...noFilters, statuses: ['active'] };
    expect(workspaceMatchesFilters(member, active)).toBe(true);
    expect(workspaceMatchesFilters(inactive, active)).toBe(false);
  });

  it('requires every selected category to pass', () => {
    const selection = { roles: ['member'], statuses: ['inactive'] };
    expect(workspaceMatchesFilters(inactive, selection)).toBe(true);
    expect(workspaceMatchesFilters(member, selection)).toBe(false);
    expect(workspaceMatchesFilters(admin, selection)).toBe(false);
  });
});
