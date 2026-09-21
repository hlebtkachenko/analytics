'use client';

import { Button, Form, Stack, TextInput } from '@bap/design-system/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { createOrganizationAction } from '../../../../lib/organizations/actions';
import {
  normalizeOrganizationSlug,
  organizationSlugSchema,
} from '../../../../lib/organizations/slug';

export default function WorkspaceForm({
  initialName,
}: Readonly<{ initialName: string }>) {
  const { t } = useTranslation();
  const [name, setName] = useState(initialName);
  const [slug, setSlug] = useState(normalizeOrganizationSlug(initialName));

  const slugValid = organizationSlugSchema.safeParse(slug).success;

  return (
    <Form
      action={createOrganizationAction}
      aria-label={t('workspaces.create.title')}
    >
      <Stack gap={6}>
        <TextInput
          id="workspace-name"
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
          helperText={t('workspaces.create.urlPreview', { url: `/${slug}` })}
          id="workspace-slug"
          invalid={slug.length > 0 && !slugValid}
          invalidText={t('workspaces.create.slugInvalid')}
          labelText={t('workspaces.create.slugLabel')}
          name="slug"
          onChange={(event) => setSlug(event.target.value)}
          required
          value={slug}
        />
        <Button disabled={!slugValid} type="submit">
          {t('workspaces.create.submit')}
        </Button>
      </Stack>
    </Form>
  );
}
