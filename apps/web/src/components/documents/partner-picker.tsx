'use client';

import {
  Button,
  ComboBox,
  InlineNotification,
  Modal,
  Stack,
  TextInput,
} from '@bap/design-system/react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { getJson, isAbortError } from '../../lib/datasets/client';
import { optional, partnersPath, sendJson } from '../../lib/documents/client';
import {
  createPartnerRequestSchema,
  partnerListSchema,
  partnerSchema,
} from '../../lib/documents/contract.ts';
import type { Partner } from '../../lib/documents/contract.ts';
import { useToast } from '../shell/toast';
import styles from './partner-picker.module.scss';

function subscribeNoop(): () => void {
  return () => undefined;
}

// The partner search combo box with its inline create modal, shared by /documents/new and the inbox item page.
export default function PartnerPicker({
  disabled = false,
  idPrefix,
  onPartnersLoaded,
  onSelect,
  organizationId,
  selectedPartnerId,
}: Readonly<{
  disabled?: boolean;
  idPrefix: string;
  // Hands every loaded or created partner to the host; pass a stable callback, since a new one refetches.
  onPartnersLoaded?: (partners: readonly Partner[]) => void;
  onSelect: (partnerId: string) => void;
  organizationId: string;
  selectedPartnerId: string;
}>) {
  const { t } = useTranslation();
  const { notify } = useToast();
  const [partners, setPartners] = useState<Partner[]>([]);
  const [query, setQuery] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState('');
  const [registrationNumber, setRegistrationNumber] = useState('');
  const [vatNumber, setVatNumber] = useState('');
  const [country, setCountry] = useState('');
  const [failed, setFailed] = useState(false);
  const createButtonRef = useRef<HTMLButtonElement>(null);
  // False on the server and during hydration, true on the client, so the portal never touches document in SSR.
  const hydrated = useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );

  useEffect(() => {
    if (organizationId.length === 0) {
      return;
    }

    const controller = new AbortController();
    void getJson(partnersPath(organizationId, query.trim()), controller.signal)
      .then((payload) => partnerListSchema.parse(payload))
      .then((payload) => {
        setPartners(payload.partners);
        onPartnersLoaded?.(payload.partners);
      })
      .catch((error: unknown) => {
        if (!isAbortError(error)) {
          setPartners([]);
        }
      });
    return () => {
      controller.abort();
    };
  }, [onPartnersLoaded, organizationId, query]);

  async function createPartner(): Promise<void> {
    const parsed = createPartnerRequestSchema.safeParse({
      countryCode: optional(country),
      name,
      registrationNumber: optional(registrationNumber),
      vatNumber: optional(vatNumber),
    });
    if (!parsed.success) {
      setFailed(true);
      return;
    }
    try {
      const partner = await sendJson(
        {
          body: parsed.data,
          method: 'POST',
          path: partnersPath(organizationId),
        },
        partnerSchema,
      );
      setPartners((current) => [partner, ...current]);
      onPartnersLoaded?.([partner]);
      onSelect(partner.id);
      setModalOpen(false);
      setFailed(false);
      setName('');
      setRegistrationNumber('');
      setVatNumber('');
      setCountry('');
      notify({ kind: 'success', title: t('documents.partnerCreated') });
    } catch {
      setFailed(true);
    }
  }

  return (
    <>
      <div className={styles.partnerRow!}>
        <ComboBox
          className={styles.partnerField!}
          disabled={disabled}
          id={`${idPrefix}-partner`}
          items={partners}
          itemToString={(partner) => partner?.name ?? ''}
          onChange={(change) => {
            onSelect(change.selectedItem?.id ?? '');
          }}
          onInputChange={(value) => {
            setQuery(value);
          }}
          selectedItem={
            partners.find((partner) => partner.id === selectedPartnerId) ?? null
          }
          titleText={t('documents.fieldPartner')}
        />
        {disabled ? null : (
          <Button
            kind="tertiary"
            onClick={() => {
              setModalOpen(true);
            }}
            ref={createButtonRef}
            type="button"
          >
            {t('documents.createPartner')}
          </Button>
        )}
      </div>
      {/* Portaled out of any host form, so Enter in the modal never submits the page's own form. */}
      {/* Stays mounted so Carbon can return focus to the launcher button on close. */}
      {hydrated &&
        createPortal(
          <Modal
            launcherButtonRef={createButtonRef}
            modalHeading={t('documents.createPartner')}
            onRequestClose={() => {
              setModalOpen(false);
            }}
            onRequestSubmit={() => {
              void createPartner();
            }}
            open={modalOpen}
            primaryButtonText={t('documents.partnerSave')}
            secondaryButtonText={t('documents.cancel')}
          >
            <Stack gap={5}>
              {failed ? (
                <InlineNotification
                  kind="error"
                  lowContrast
                  role="alert"
                  title={t('documents.partnerFailed')}
                />
              ) : null}
              <TextInput
                id={`${idPrefix}-partner-name`}
                labelText={t('documents.partnerName')}
                onChange={(event) => {
                  setName(event.target.value);
                }}
                value={name}
              />
              <TextInput
                id={`${idPrefix}-partner-registration-number`}
                labelText={t('documents.partnerRegistrationNumber')}
                onChange={(event) => {
                  setRegistrationNumber(event.target.value);
                }}
                value={registrationNumber}
              />
              <TextInput
                id={`${idPrefix}-partner-vat-number`}
                labelText={t('documents.partnerVatNumber')}
                onChange={(event) => {
                  setVatNumber(event.target.value);
                }}
                value={vatNumber}
              />
              <TextInput
                id={`${idPrefix}-partner-country`}
                labelText={t('documents.partnerCountry')}
                onChange={(event) => {
                  setCountry(event.target.value);
                }}
                value={country}
              />
            </Stack>
          </Modal>,
          document.body,
        )}
    </>
  );
}
