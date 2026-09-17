// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { updateMemberEntityScopeAction } from './entity-actions';

const mocks = vi.hoisted(() => ({
  redirect: vi.fn(),
  resolveOrganizationRouteForRequest: vi.fn(),
  revalidatePath: vi.fn(),
  writeMemberEntityScope: vi.fn(),
}));

vi.mock('./entities', () => ({
  writeMemberEntityScope: mocks.writeMemberEntityScope,
}));
vi.mock('./resolver', () => ({
  resolveOrganizationRouteForRequest: mocks.resolveOrganizationRouteForRequest,
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));

const LEGAL_ENTITY_ID = '9b7d1c30-6a4b-4d1f-9c2e-7a5f0e3b8d21';
const OTHER_LEGAL_ENTITY_ID = '4c2f8b11-8c35-4a2e-9f61-1de2f0a7c934';

const organization = {
  id: 'organization-1',
  name: 'Organization One',
  role: 'owner',
  slug: 'organization-one',
} as const;

function form(values: Record<string, string | string[]>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(values)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        data.append(name, item);
      }
    } else {
      data.set(name, value);
    }
  }
  return data;
}

describe('member entity scope server action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveOrganizationRouteForRequest.mockResolvedValue(organization);
    mocks.writeMemberEntityScope.mockResolvedValue(true);
  });

  it('writes both entity scope shapes for an owner', async () => {
    await updateMemberEntityScopeAction(
      'organization-one',
      form({ mode: 'all', userId: 'user-2' }),
    );
    await updateMemberEntityScopeAction(
      'organization-one',
      form({
        legalEntityIds: [LEGAL_ENTITY_ID, OTHER_LEGAL_ENTITY_ID],
        mode: 'restricted',
        userId: 'user-2',
      }),
    );

    expect(mocks.writeMemberEntityScope).toHaveBeenNthCalledWith(
      1,
      'organization-1',
      'user-2',
      { mode: 'all' },
    );
    expect(mocks.writeMemberEntityScope).toHaveBeenNthCalledWith(
      2,
      'organization-1',
      'user-2',
      {
        legalEntityIds: [LEGAL_ENTITY_ID, OTHER_LEGAL_ENTITY_ID],
        mode: 'restricted',
      },
    );
    expect(mocks.redirect).toHaveBeenLastCalledWith(
      '/organization-one/members?result=success',
    );
  });

  it.each(['admin', 'member'] as const)(
    'refuses the owner-only entity scope write to an %s',
    async (role) => {
      mocks.resolveOrganizationRouteForRequest.mockResolvedValue({
        ...organization,
        role,
      });

      await updateMemberEntityScopeAction(
        'organization-one',
        form({ mode: 'all', userId: 'user-2' }),
      );

      expect(mocks.writeMemberEntityScope).not.toHaveBeenCalled();
      expect(mocks.redirect).toHaveBeenCalledWith(
        '/organization-one/members?result=error',
      );
    },
  );

  it('rejects an invalid action scope with one fixed same-origin redirect', async () => {
    await updateMemberEntityScopeAction(
      'organization%2Fmembers',
      form({ mode: 'all', userId: 'user-2' }),
    );

    expect(mocks.redirect).toHaveBeenCalledExactlyOnceWith(
      '/organizations?result=error',
    );
    expect(mocks.resolveOrganizationRouteForRequest).not.toHaveBeenCalled();
    expect(mocks.writeMemberEntityScope).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
