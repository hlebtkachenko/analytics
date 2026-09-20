'use client';

import {
  Button,
  Form,
  InlineNotification,
  Modal,
  Stack,
  TextInput,
} from '@bap/design-system/react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useToast } from '../../../../components/shell/toast';
import { authClient } from '../../../../lib/auth/client';
import { memberStatusPath, mutateJson } from '../../../../lib/datasets/client';
import {
  normalizeOrganizationSlug,
  organizationSlugSchema,
} from '../../../../lib/organizations/slug';

type SettingsViewProperties = Readonly<{
  canManageOrganization: boolean;
  organizationId: string;
  workspaceName: string;
  workspaceSlug: string;
}>;

export default function SettingsView({
  canManageOrganization,
  organizationId,
  workspaceName,
  workspaceSlug,
}: SettingsViewProperties) {
  const { t } = useTranslation();
  const { notify } = useToast();
  const router = useRouter();

  const [name, setName] = useState(workspaceName);
  const [slug, setSlug] = useState(workspaceSlug);
  const [slugTaken, setSlugTaken] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);

  const nextSlug = normalizeOrganizationSlug(slug);
  const slugValid = organizationSlugSchema.safeParse(nextSlug).success;
  const canSave =
    !submitting && slugValid && name.trim().length > 0 && !slugTaken;

  async function save(): Promise<void> {
    const trimmedName = name.trim();
    setSubmitting(true);
    setSlugTaken(false);
    const result = await authClient.organization.update({
      data: { name: trimmedName, slug: nextSlug },
      organizationId,
    });
    setSubmitting(false);

    if (!result.error) {
      notify({ kind: 'success', title: t('settings.general.saveSuccess') });
      // A slug change moves the route, and every save refreshes the active organization context.
      if (nextSlug !== workspaceSlug) {
        router.push(`/${nextSlug}/settings` as Route);
      }
      router.refresh();
      return;
    }

    if (result.error.code === 'ORGANIZATION_SLUG_ALREADY_TAKEN') {
      setSlugTaken(true);
      return;
    }
    notify({ kind: 'error', title: t('settings.general.saveFailure') });
  }

  async function confirmLeave(): Promise<void> {
    setSubmitting(true);
    setLeaveError(null);
    // Leaving is a self-deactivation: the membership row is retained, so audit history never loses who did what.
    const session = await authClient.getSession();
    const userId = session.data?.user.id;

    if (userId === undefined) {
      setSubmitting(false);
      notify({ kind: 'error', title: t('settings.leave.failure') });
      return;
    }

    const result = await mutateJson(memberStatusPath(organizationId, userId), {
      body: { status: 'inactive' },
      method: 'PUT',
    });
    setSubmitting(false);

    if (result.ok) {
      router.push('/organizations?result=workspace-left');
      return;
    }

    // The API refuses the last active owner with 409, which maps to the existing last-owner message.
    if (result.status === 409) {
      setLeaveError(t('settings.leave.lastOwner'));
      return;
    }
    notify({ kind: 'error', title: t('settings.leave.failure') });
  }

  return (
    <>
      <h1>{t('settings.title', { name: workspaceName })}</h1>

      <Form aria-label={t('settings.general.title')}>
        <Stack gap={6}>
          <TextInput
            id="workspace-name"
            labelText={t('settings.general.nameLabel')}
            onChange={(event) => {
              setName(event.target.value);
            }}
            readOnly={!canManageOrganization}
            value={name}
          />
          <TextInput
            autoComplete="off"
            helperText={t('settings.general.urlPreview', { url: `/${slug}` })}
            id="workspace-slug"
            invalid={
              canManageOrganization &&
              ((slug.length > 0 && !slugValid) || slugTaken)
            }
            invalidText={
              slugTaken
                ? t('settings.general.slugTaken')
                : t('settings.general.slugInvalid')
            }
            labelText={t('settings.general.slugLabel')}
            onChange={(event) => {
              setSlug(event.target.value);
              setSlugTaken(false);
            }}
            readOnly={!canManageOrganization}
            value={slug}
          />
          {canManageOrganization ? (
            <Button
              disabled={!canSave}
              onClick={() => {
                void save();
              }}
              type="button"
            >
              {t('settings.general.save')}
            </Button>
          ) : null}
        </Stack>
      </Form>

      <section aria-labelledby="settings-danger-heading">
        <h2 id="settings-danger-heading">{t('settings.leave.heading')}</h2>
        <Button
          kind="danger"
          onClick={() => {
            setLeaveError(null);
            setLeaveOpen(true);
          }}
          type="button"
        >
          {t('settings.leave.action')}
        </Button>
      </section>

      {leaveOpen ? (
        <Modal
          danger
          modalHeading={t('settings.leave.title', { name: workspaceName })}
          onRequestClose={() => {
            setLeaveOpen(false);
          }}
          onRequestSubmit={() => {
            void confirmLeave();
          }}
          open
          primaryButtonDisabled={submitting}
          primaryButtonText={t('settings.leave.confirm')}
          secondaryButtonText={t('settings.leave.cancel')}
        >
          <Stack gap={5}>
            <p>{t('settings.leave.body')}</p>
            {leaveError !== null ? (
              <InlineNotification
                hideCloseButton
                kind="error"
                lowContrast
                role="alert"
                title={leaveError}
              />
            ) : null}
          </Stack>
        </Modal>
      ) : null}
    </>
  );
}
