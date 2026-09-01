'use client';

import { Checkmark } from '@bap/design-system/icons';
import {
  Button,
  InlineLoading,
  InlineNotification,
  Stack,
  Tile,
} from '@bap/design-system/react';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

// Better Auth stores an invitation with several roles as one comma-joined string.
const invitationRolesSchema = z
  .string()
  .min(1)
  .transform((value) => value.split(',').map((role) => role.trim()))
  .pipe(z.array(z.enum(['owner', 'admin', 'member'])).min(1));

const invitationSchema = z.object({
  id: z.string().min(1),
  organizationName: z.string().min(1),
  role: invitationRolesSchema,
});

type Invitation = z.infer<typeof invitationSchema>;

async function getJson(path: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(path, { cache: 'no-store', signal });
  if (!response.ok) {
    throw new Error('Request failed.');
  }
  return await response.json();
}

export default function InvitationPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { invitationId } = useParams<{ invitationId: string }>();
  const [invitation, setInvitation] = useState<Invitation>();
  const [acceptFailed, setAcceptFailed] = useState(false);
  const [state, setState] = useState<'error' | 'idle' | 'loading'>('loading');

  useEffect(() => {
    const controller = new AbortController();
    void getJson(
      `/api/auth/organization/get-invitation?id=${encodeURIComponent(invitationId)}`,
      controller.signal,
    )
      .then((payload) => invitationSchema.parse(payload))
      .then((item) => {
        setInvitation(item);
        setState('idle');
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          setInvitation(undefined);
          setState('error');
        }
      });
    return () => controller.abort();
  }, [invitationId]);

  async function accept(): Promise<void> {
    setAcceptFailed(false);
    // A rejected fetch would otherwise surface as an unhandled rejection and no visible feedback.
    try {
      const response = await fetch('/api/auth/organization/accept-invitation', {
        body: JSON.stringify({ invitationId }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });
      if (!response.ok) {
        setAcceptFailed(true);
        return;
      }
    } catch {
      setAcceptFailed(true);
      return;
    }
    router.replace('/access');
  }

  return (
    <main>
      <Stack gap={7}>
        <h1>{t('invitation.title')}</h1>
        {state === 'loading' ? (
          <InlineLoading description={t('invitation.loading')} />
        ) : null}
        {state === 'error' ? (
          <InlineNotification
            kind="error"
            lowContrast
            title={t('invitation.error')}
          />
        ) : null}
        {acceptFailed ? (
          <InlineNotification
            kind="error"
            lowContrast
            title={t('invitation.acceptFailed')}
          />
        ) : null}
        {invitation ? (
          <Tile>
            <Stack gap={5}>
              <p>{t('invitation.summary')}</p>
              <p>
                {t('invitation.organization')}: {invitation.organizationName}
              </p>
              <p>
                {t('invitation.role')}: {invitation.role.join(', ')}
              </p>
              {/* Acceptance is authorized by the session, the page only offers the action. */}
              <Button
                onClick={() => void accept()}
                renderIcon={Checkmark}
                type="button"
              >
                {t('invitation.accept')}
              </Button>
            </Stack>
          </Tile>
        ) : null}
      </Stack>
    </main>
  );
}
