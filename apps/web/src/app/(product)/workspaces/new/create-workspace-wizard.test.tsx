import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createWorkspaceAction: vi.fn(),
  inviteMemberWithScopeAction: vi.fn(),
  mutateJson: vi.fn(),
  push: vi.fn(),
}));

vi.mock('../../../../lib/organizations/actions', () => ({
  createWorkspaceAction: mocks.createWorkspaceAction,
  inviteMemberWithScopeAction: mocks.inviteMemberWithScopeAction,
}));
vi.mock('../../../../lib/datasets/client', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../lib/datasets/client')
  >('../../../../lib/datasets/client');
  return { ...actual, mutateJson: mocks.mutateJson };
});
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
}));

import { I18nProvider } from '../../../../i18n/client-provider';
import CreateWorkspaceWizard from './create-workspace-wizard';

const ENTITY_ID = '9b7d1c30-6a4b-4d1f-9c2e-7a5f0e3b8d21';

const createdEntity = {
  createdAt: '2026-01-01T00:00:00.000Z',
  id: ENTITY_ID,
  kind: 'company' as const,
  name: 'Acme Trading',
  registrationNumber: null,
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function renderWizard() {
  return render(
    <I18nProvider>
      <CreateWorkspaceWizard initialName="Acme Workspace" />
    </I18nProvider>,
  );
}

async function createWorkspace() {
  mocks.createWorkspaceAction.mockResolvedValue({
    id: 'organization-1',
    ok: true,
    slug: 'acme-workspace',
  });
  fireEvent.click(screen.getByText('Next'));
  expect(await screen.findByText('Add entity')).toBeVisible();
}

afterEach(cleanup);

describe('CreateWorkspaceWizard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates the workspace, locks step one and advances to the entity step', async () => {
    renderWizard();

    expect(screen.getByLabelText('Name')).toHaveValue('Acme Workspace');
    await createWorkspace();

    expect(mocks.createWorkspaceAction).toHaveBeenCalledWith({
      name: 'Acme Workspace',
      slug: 'acme-workspace',
    });

    // Going back to step one shows it locked so the workspace cannot be recreated.
    fireEvent.click(screen.getByText('Back'));
    expect(await screen.findByLabelText('Name')).toBeDisabled();
    expect(screen.getByLabelText('Slug')).toBeDisabled();
  });

  it('keeps the wizard on step one and shows the reason when create fails', async () => {
    renderWizard();
    mocks.createWorkspaceAction.mockResolvedValue({
      ok: false,
      reason: 'slug-taken',
    });

    fireEvent.click(screen.getByText('Next'));

    expect(
      await screen.findByText('That workspace address is already taken.'),
    ).toBeVisible();
    expect(screen.queryByText('Add entity')).not.toBeInTheDocument();
  });

  it('skips both optional steps and finishes to the workspace', async () => {
    renderWizard();
    await createWorkspace();

    fireEvent.click(screen.getByText('Skip'));
    expect(await screen.findByText('Send invitation')).toBeVisible();

    // With no entity created, the restricted scope option is not offered.
    expect(screen.queryByLabelText('Entity access')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Finish'));
    expect(mocks.push).toHaveBeenCalledWith('/acme-workspace');
    expect(mocks.mutateJson).not.toHaveBeenCalled();
  });

  it('creates an entity, then invites with a restricted scope naming it', async () => {
    renderWizard();
    await createWorkspace();

    mocks.mutateJson.mockResolvedValue({ data: createdEntity, ok: true });
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Acme Trading' },
    });
    fireEvent.click(screen.getByText('Add entity'));

    expect(await screen.findByText('Send invitation')).toBeVisible();
    const scope = screen.getByLabelText('Entity access');
    fireEvent.change(scope, { target: { value: 'restricted' } });
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'teammate@bap.test' },
    });

    mocks.inviteMemberWithScopeAction.mockResolvedValue({ ok: true });
    fireEvent.click(screen.getByText('Send invitation'));

    await waitFor(() =>
      expect(mocks.inviteMemberWithScopeAction).toHaveBeenCalledWith({
        email: 'teammate@bap.test',
        organizationId: 'organization-1',
        role: 'member',
        scope: { legalEntityIds: [ENTITY_ID], mode: 'restricted' },
      }),
    );
  });
});
