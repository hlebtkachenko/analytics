'use client';

import { useState } from 'react';

import { createOrganizationAction } from '../../../../lib/organizations/actions';
import { normalizeOrganizationSlug } from '../../../../lib/organizations/slug';

export default function OrganizationForm({
  initialName,
}: Readonly<{ initialName: string }>) {
  const [name, setName] = useState(initialName);
  const [slug, setSlug] = useState(normalizeOrganizationSlug(initialName));

  return (
    <form action={createOrganizationAction} aria-label="Create organization">
      <p>
        <label htmlFor="organization-name">Name</label>
        <input
          id="organization-name"
          name="name"
          onChange={(event) => {
            const nextName = event.target.value;
            setName(nextName);
            setSlug(normalizeOrganizationSlug(nextName));
          }}
          required
          value={name}
        />
      </p>
      <p>
        <label htmlFor="organization-slug">Slug</label>
        <input
          autoComplete="off"
          id="organization-slug"
          maxLength={20}
          minLength={3}
          name="slug"
          onChange={(event) => setSlug(event.target.value)}
          pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
          required
          value={slug}
        />
      </p>
      <button type="submit">Create organization</button>
    </form>
  );
}
