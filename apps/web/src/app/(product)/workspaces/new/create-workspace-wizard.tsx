'use client';

import {
  Button,
  Form,
  InlineNotification,
  ProgressIndicator,
  ProgressStep,
  Select,
  SelectItem,
  Stack,
  TextInput,
} from '@bap/design-system/react';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import {
  legalEntitiesPath,
  legalEntitySchema,
  mutateJson,
} from '../../../../lib/datasets/client';
import {
  createWorkspaceAction,
  inviteMemberWithScopeAction,
} from '../../../../lib/organizations/actions';
import {
  normalizeOrganizationSlug,
  organizationSlugSchema,
} from '../../../../lib/organizations/slug';

type EntityKind = 'company' | 'sole_trader';

// The entity draft the step validates before any request; the BFF and API validate again.
const entityDraftSchema = z.object({
  kind: z.enum(['company', 'sole_trader']),
  name: z.string().trim().min(1).max(200),
  registrationNumber: z.union([
    z.literal(''),
    z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9-]+$/),
  ]),
});

// A select value comes from the two-option list, so an unknown value falls back.
function asKind(value: string): EntityKind {
  return value === 'sole_trader' ? 'sole_trader' : 'company';
}

type CreatedEntity = Readonly<{ id: string; name: string }>;

type InviteRole = 'admin' | 'member';
type InviteScopeMode = 'all' | 'restricted';

type InviteRow = Readonly<{
  email: string;
  role: InviteRole;
  scopeMode: InviteScopeMode;
  status: 'idle' | 'sending' | 'sent';
  error: string | null;
}>;

function emptyInviteRow(): InviteRow {
  return {
    email: '',
    error: null,
    role: 'member',
    scopeMode: 'all',
    status: 'idle',
  };
}

const emailSchema = z.email().max(254);

export default function CreateWorkspaceWizard({
  initialName,
}: Readonly<{ initialName: string }>) {
  const { t } = useTranslation();
  const router = useRouter();
  const fieldPrefix = useId();

  const [step, setStep] = useState(0);

  // Step 1 workspace state.
  const [name, setName] = useState(initialName);
  const [slug, setSlug] = useState(normalizeOrganizationSlug(initialName));
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [organization, setOrganization] = useState<Readonly<{
    id: string;
    slug: string;
  }> | null>(null);

  // Step 2 legal entity state.
  const [entityKind, setEntityKind] = useState<EntityKind>('company');
  const [entityName, setEntityName] = useState('');
  const [registrationNumber, setRegistrationNumber] = useState('');
  const [registrationInvalid, setRegistrationInvalid] = useState(false);
  const [entityNameInUse, setEntityNameInUse] = useState(false);
  const [entityError, setEntityError] = useState<string | null>(null);
  const [savingEntity, setSavingEntity] = useState(false);
  const [createdEntity, setCreatedEntity] = useState<CreatedEntity | null>(
    null,
  );

  // Step 3 invite state.
  const [invites, setInvites] = useState<readonly InviteRow[]>([
    emptyInviteRow(),
  ]);
  const [finishing, setFinishing] = useState(false);

  const slugValid = organizationSlugSchema.safeParse(slug).success;
  const locked = organization !== null;

  const createResultMessages: Readonly<Record<string, string>> = {
    error: t('workspaces.create.unavailable'),
    invalid: t('workspaces.create.slugInvalid'),
    'quota-exhausted': t('workspaces.create.quotaExhausted'),
    'slug-taken': t('workspaces.create.slugTaken'),
  };

  async function createWorkspace(): Promise<void> {
    if (locked || !slugValid) {
      return;
    }
    setCreating(true);
    setCreateError(null);
    const result = await createWorkspaceAction({ name, slug });
    setCreating(false);
    if (!result.ok) {
      setCreateError(
        createResultMessages[result.reason] ??
          t('workspaces.create.unavailable'),
      );
      return;
    }
    setOrganization({ id: result.id, slug: result.slug });
    setStep(1);
  }

  async function addEntity(): Promise<void> {
    if (organization === null) {
      return;
    }
    const parsed = entityDraftSchema.safeParse({
      kind: entityKind,
      name: entityName,
      registrationNumber: registrationNumber.trim(),
    });
    if (!parsed.success) {
      setRegistrationInvalid(true);
      return;
    }
    const registration =
      parsed.data.registrationNumber.length > 0
        ? parsed.data.registrationNumber
        : undefined;

    setSavingEntity(true);
    setEntityNameInUse(false);
    setRegistrationInvalid(false);
    setEntityError(null);
    const result = await mutateJson(legalEntitiesPath(organization.id), {
      body: {
        kind: parsed.data.kind,
        name: parsed.data.name,
        ...(registration === undefined
          ? {}
          : { registrationNumber: registration }),
      },
      method: 'POST',
    });
    setSavingEntity(false);

    if (result.ok) {
      const entity = legalEntitySchema.safeParse(result.data);
      if (!entity.success) {
        setEntityError(t('workspaces.create.entity.failure'));
        return;
      }
      setCreatedEntity({ id: entity.data.id, name: entity.data.name });
      setStep(2);
      return;
    }

    // A duplicate name is the one failure the step keeps distinct and inline.
    if (result.status === 409) {
      setEntityNameInUse(true);
      return;
    }
    // The API rejects an invalid registration number format, shown inline on its field.
    if (result.status === 400) {
      setRegistrationInvalid(true);
      return;
    }
    setEntityError(t('workspaces.create.entity.failure'));
  }

  function updateInvite(index: number, patch: Partial<InviteRow>): void {
    setInvites((rows) =>
      rows.map((row, position) =>
        position === index ? { ...row, ...patch } : row,
      ),
    );
  }

  const inviteReasonKeys: Readonly<
    Record<'already-invited' | 'already-member' | 'error' | 'invalid', string>
  > = {
    'already-invited': 'workspaces.create.invite.alreadyInvited',
    'already-member': 'workspaces.create.invite.alreadyMember',
    error: 'workspaces.create.invite.failure',
    invalid: 'workspaces.create.invite.emailInvalid',
  };

  async function sendInvite(index: number): Promise<void> {
    const row = invites[index];
    if (organization === null || row === undefined) {
      return;
    }
    if (!emailSchema.safeParse(row.email).success) {
      updateInvite(index, {
        error: t('workspaces.create.invite.emailInvalid'),
      });
      return;
    }
    updateInvite(index, { error: null, status: 'sending' });
    const scope =
      row.scopeMode === 'restricted' && createdEntity !== null
        ? { legalEntityIds: [createdEntity.id], mode: 'restricted' as const }
        : { mode: 'all' as const };
    const result = await inviteMemberWithScopeAction({
      email: row.email,
      organizationId: organization.id,
      role: row.role,
      scope,
    });
    if (result.ok) {
      updateInvite(index, { error: null, status: 'sent' });
      return;
    }
    updateInvite(index, {
      error: t(inviteReasonKeys[result.reason]),
      status: 'idle',
    });
  }

  function finish(): void {
    if (organization === null) {
      return;
    }
    setFinishing(true);
    router.push(`/${organization.slug}`);
  }

  return (
    <Stack gap={7}>
      <ProgressIndicator currentIndex={step} spaceEqually>
        <ProgressStep label={t('workspaces.create.steps.workspace')} />
        <ProgressStep label={t('workspaces.create.steps.entity')} />
        <ProgressStep label={t('workspaces.create.steps.invite')} />
      </ProgressIndicator>

      {step === 0 ? (
        <Form
          aria-label={t('workspaces.create.title')}
          onSubmit={(event) => {
            event.preventDefault();
            void createWorkspace();
          }}
        >
          <Stack gap={6}>
            {createError !== null ? (
              <InlineNotification
                hideCloseButton
                kind="error"
                lowContrast
                role="alert"
                title={createError}
              />
            ) : null}
            <TextInput
              disabled={locked}
              id={`${fieldPrefix}-name`}
              labelText={t('workspaces.create.nameLabel')}
              name="name"
              onChange={(event) => {
                const nextName = event.target.value;
                setName(nextName);
                setSlug(normalizeOrganizationSlug(nextName));
              }}
              required
              value={name}
            />
            <TextInput
              autoComplete="off"
              disabled={locked}
              helperText={t('workspaces.create.urlPreview', {
                url: `/${slug}`,
              })}
              id={`${fieldPrefix}-slug`}
              invalid={slug.length > 0 && !slugValid}
              invalidText={t('workspaces.create.slugInvalid')}
              labelText={t('workspaces.create.slugLabel')}
              name="slug"
              onChange={(event) => setSlug(event.target.value)}
              required
              value={slug}
            />
            <Button disabled={!slugValid || creating || locked} type="submit">
              {t('workspaces.create.next')}
            </Button>
          </Stack>
        </Form>
      ) : null}

      {step === 1 ? (
        <Form
          aria-label={t('workspaces.create.steps.entity')}
          onSubmit={(event) => {
            event.preventDefault();
            void addEntity();
          }}
        >
          <Stack gap={6}>
            {entityError !== null ? (
              <InlineNotification
                hideCloseButton
                kind="error"
                lowContrast
                role="alert"
                title={entityError}
              />
            ) : null}
            <Select
              id={`${fieldPrefix}-entity-kind`}
              labelText={t('workspaces.create.entity.kindLabel')}
              onChange={(event) => setEntityKind(asKind(event.target.value))}
              value={entityKind}
            >
              <SelectItem
                text={t('workspaces.create.entity.kindCompany')}
                value="company"
              />
              <SelectItem
                text={t('workspaces.create.entity.kindSoleTrader')}
                value="sole_trader"
              />
            </Select>
            <TextInput
              id={`${fieldPrefix}-entity-name`}
              invalid={entityNameInUse}
              invalidText={t('workspaces.create.entity.nameInUse')}
              labelText={t('workspaces.create.entity.nameLabel')}
              onChange={(event) => {
                setEntityName(event.target.value);
                setEntityNameInUse(false);
              }}
              value={entityName}
            />
            <TextInput
              id={`${fieldPrefix}-entity-registration`}
              invalid={registrationInvalid}
              invalidText={t('workspaces.create.entity.registrationInvalid')}
              labelText={t('workspaces.create.entity.registrationLabel')}
              onChange={(event) => {
                setRegistrationNumber(event.target.value);
                setRegistrationInvalid(false);
              }}
              value={registrationNumber}
            />
            <Stack gap={4} orientation="horizontal">
              <Button kind="ghost" onClick={() => setStep(2)} type="button">
                {t('workspaces.create.skip')}
              </Button>
              <Button disabled={savingEntity} type="submit">
                {t('workspaces.create.entity.submit')}
              </Button>
            </Stack>
          </Stack>
        </Form>
      ) : null}

      {step === 2 ? (
        <Stack gap={6}>
          <p>{t('workspaces.create.invite.intro')}</p>
          {invites.map((row, index) => (
            <Stack gap={4} key={index}>
              {row.error !== null ? (
                <InlineNotification
                  hideCloseButton
                  kind="error"
                  lowContrast
                  role="alert"
                  title={row.error}
                />
              ) : null}
              {row.status === 'sent' ? (
                <InlineNotification
                  hideCloseButton
                  kind="success"
                  lowContrast
                  title={t('workspaces.create.invite.sent', {
                    email: row.email,
                  })}
                />
              ) : null}
              <TextInput
                disabled={row.status === 'sent'}
                id={`${fieldPrefix}-invite-email-${index}`}
                labelText={t('workspaces.create.invite.emailLabel')}
                onChange={(event) =>
                  updateInvite(index, {
                    email: event.target.value,
                    error: null,
                  })
                }
                value={row.email}
              />
              <Select
                disabled={row.status === 'sent'}
                id={`${fieldPrefix}-invite-role-${index}`}
                labelText={t('workspaces.create.invite.roleLabel')}
                onChange={(event) =>
                  updateInvite(index, {
                    role: event.target.value === 'admin' ? 'admin' : 'member',
                  })
                }
                value={row.role}
              >
                <SelectItem
                  text={t('workspaces.create.invite.roleAdmin')}
                  value="admin"
                />
                <SelectItem
                  text={t('workspaces.create.invite.roleMember')}
                  value="member"
                />
              </Select>
              {createdEntity !== null ? (
                <Select
                  disabled={row.status === 'sent'}
                  id={`${fieldPrefix}-invite-scope-${index}`}
                  labelText={t('workspaces.create.invite.scopeLabel')}
                  onChange={(event) =>
                    updateInvite(index, {
                      scopeMode:
                        event.target.value === 'restricted'
                          ? 'restricted'
                          : 'all',
                    })
                  }
                  value={row.scopeMode}
                >
                  <SelectItem
                    text={t('workspaces.create.invite.scopeAll')}
                    value="all"
                  />
                  <SelectItem
                    text={t('workspaces.create.invite.scopeRestricted', {
                      name: createdEntity.name,
                    })}
                    value="restricted"
                  />
                </Select>
              ) : null}
              <Button
                disabled={row.status !== 'idle'}
                onClick={() => void sendInvite(index)}
                type="button"
              >
                {t('workspaces.create.invite.send')}
              </Button>
            </Stack>
          ))}
          <Button
            kind="ghost"
            onClick={() => setInvites((rows) => [...rows, emptyInviteRow()])}
            type="button"
          >
            {t('workspaces.create.invite.addRow')}
          </Button>
          <Button disabled={finishing} onClick={finish} type="button">
            {t('workspaces.create.finish')}
          </Button>
        </Stack>
      ) : null}

      {step > 0 && !finishing ? (
        <Button
          disabled={creating || savingEntity}
          kind="ghost"
          onClick={() => setStep((current) => current - 1)}
          type="button"
        >
          {t('workspaces.create.stepBack')}
        </Button>
      ) : null}
    </Stack>
  );
}
