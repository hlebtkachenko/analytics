// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createLegalEntityAction,
  deleteLegalEntityAction,
  updateLegalEntityAction,
  updateMemberEntityScopeAction,
} from './entity-actions';

const mocks = vi.hoisted(() => ({
  createLegalEntity: vi.fn(),
  redirect: vi.fn(),
  removeLegalEntity: vi.fn(),
  resolveOrganizationRouteForRequest: vi.fn(),
  revalidatePath: vi.fn(),
  updateLegalEntity: vi.fn(),
  writeMemberEntityScope: vi.fn(),
}));

vi.mock('./entities', () => ({
  createLegalEntity: mocks.createLegalEntity,
  removeLegalEntity: mocks.removeLegalEntity,
  updateLegalEntity: mocks.updateLegalEntity,
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

describe('legal entity server actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveOrganizationRouteForRequest.mockResolvedValue(organization);
    mocks.createLegalEntity.mockResolvedValue(true);
    mocks.removeLegalEntity.mockResolvedValue(true);
    mocks.updateLegalEntity.mockResolvedValue(true);
    mocks.writeMemberEntityScope.mockResolvedValue(true);
  });

  it('creates with a trimmed body and the resolved organization id', async () => {
    await createLegalEntityAction(
      'organization-one',
      form({
        kind: 'sole_trader',
        name: '  Placeholder Trader  ',
        organizationId: 'forged-organization',
        registrationNumber: '  ST-9  ',
      }),
    );

    expect(mocks.createLegalEntity).toHaveBeenCalledWith('organization-1', {
      kind: 'sole_trader',
      name: 'Placeholder Trader',
      registrationNumber: 'ST-9',
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith(
      '/organization-one/entities',
    );
    expect(mocks.redirect).toHaveBeenCalledWith(
      '/organization-one/entities?result=success',
    );
  });

  it('omits a blank registration number and refuses an unknown kind', async () => {
    await createLegalEntityAction(
      'organization-one',
      form({
        kind: 'company',
        name: 'Placeholder Holding',
        registrationNumber: '   ',
      }),
    );
    await createLegalEntityAction(
      'organization-one',
      form({ kind: 'charity', name: 'Placeholder Charity' }),
    );

    expect(mocks.createLegalEntity).toHaveBeenCalledExactlyOnceWith(
      'organization-1',
      { kind: 'company', name: 'Placeholder Holding' },
    );
    expect(mocks.redirect.mock.calls.map((call) => call[0])).toEqual([
      '/organization-one/entities?result=success',
      '/organization-one/entities?result=error',
    ]);
  });

  it('updates and deletes the selected entity only', async () => {
    await updateLegalEntityAction(
      'organization-one',
      form({
        kind: 'company',
        legalEntityId: LEGAL_ENTITY_ID,
        name: 'Renamed Holding',
      }),
    );
    await deleteLegalEntityAction(
      'organization-one',
      form({ legalEntityId: LEGAL_ENTITY_ID }),
    );

    expect(mocks.updateLegalEntity).toHaveBeenCalledWith(
      'organization-1',
      LEGAL_ENTITY_ID,
      { kind: 'company', name: 'Renamed Holding' },
    );
    expect(mocks.removeLegalEntity).toHaveBeenCalledWith(
      'organization-1',
      LEGAL_ENTITY_ID,
    );
  });

  it('refuses a malformed entity id before any call', async () => {
    await updateLegalEntityAction(
      'organization-one',
      form({ kind: 'company', legalEntityId: 'not-a-uuid', name: 'Renamed' }),
    );
    await deleteLegalEntityAction(
      'organization-one',
      form({ legalEntityId: 'not-a-uuid' }),
    );

    expect(mocks.updateLegalEntity).not.toHaveBeenCalled();
    expect(mocks.removeLegalEntity).not.toHaveBeenCalled();
    expect(mocks.resolveOrganizationRouteForRequest).not.toHaveBeenCalled();
    expect(mocks.redirect.mock.calls.map((call) => call[0])).toEqual([
      '/organization-one/entities?result=error',
      '/organization-one/entities?result=error',
    ]);
  });

  it('reports a refused write behind a fixed result path', async () => {
    mocks.createLegalEntity.mockResolvedValue(false);

    await createLegalEntityAction(
      'organization-one',
      form({ kind: 'company', name: 'Placeholder Holding' }),
    );

    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(mocks.redirect).toHaveBeenCalledWith(
      '/organization-one/entities?result=error',
    );
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

  it.each([
    ['create', '/attacker.example'],
    ['update', '//attacker.example'],
    ['delete', 'organization--one'],
    ['scope', 'organization%2Fmembers'],
  ])(
    'rejects an invalid %s action scope with one fixed same-origin redirect',
    async (action, unsafeSlug) => {
      if (action === 'create') {
        await createLegalEntityAction(
          unsafeSlug,
          form({ kind: 'company', name: 'Placeholder Holding' }),
        );
      } else if (action === 'update') {
        await updateLegalEntityAction(
          unsafeSlug,
          form({
            kind: 'company',
            legalEntityId: LEGAL_ENTITY_ID,
            name: 'Renamed Holding',
          }),
        );
      } else if (action === 'delete') {
        await deleteLegalEntityAction(
          unsafeSlug,
          form({ legalEntityId: LEGAL_ENTITY_ID }),
        );
      } else {
        await updateMemberEntityScopeAction(
          unsafeSlug,
          form({ mode: 'all', userId: 'user-2' }),
        );
      }

      expect(mocks.redirect).toHaveBeenCalledExactlyOnceWith(
        '/organizations?result=error',
      );
      expect(mocks.resolveOrganizationRouteForRequest).not.toHaveBeenCalled();
      expect(mocks.createLegalEntity).not.toHaveBeenCalled();
      expect(mocks.updateLegalEntity).not.toHaveBeenCalled();
      expect(mocks.removeLegalEntity).not.toHaveBeenCalled();
      expect(mocks.writeMemberEntityScope).not.toHaveBeenCalled();
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
    },
  );
});
