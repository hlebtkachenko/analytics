// Throwaway milestone 2 UI: delete when the Carbon organization screens land.

import Link from 'next/link';
import { notFound } from 'next/navigation';

import {
  createLegalEntityAction,
  deleteLegalEntityAction,
  updateLegalEntityAction,
} from '../../../lib/organizations/entity-actions';
import {
  readLegalEntities,
  readOrganizationAccess,
} from '../../../lib/organizations/entities';
import { resolveOrganizationRouteForRequest } from '../../../lib/organizations/resolver';

const entityKinds = [
  { label: 'Company', value: 'company' },
  { label: 'Sole trader', value: 'sole_trader' },
] as const;

function kindLabel(kind: 'company' | 'sole_trader'): string {
  return kind === 'company' ? 'Company' : 'Sole trader';
}

export default async function OrganizationEntitiesPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{ result?: string }>;
}>) {
  const { orgSlug } = await params;
  const organization = await resolveOrganizationRouteForRequest(orgSlug);
  if (organization === null) {
    notFound();
  }

  // Capabilities only choose which forms are offered, the API and the database enforce access.
  const [access, entities] = await Promise.all([
    readOrganizationAccess(organization.id),
    readLegalEntities(organization.id),
  ]);
  const failed = access === null || entities === null;
  const capabilities = access?.capabilities;
  const { result } = await searchParams;
  const createEntity = createLegalEntityAction.bind(null, organization.slug);
  const updateEntity = updateLegalEntityAction.bind(null, organization.slug);
  const deleteEntity = deleteLegalEntityAction.bind(null, organization.slug);

  return (
    <main id="main-content" tabIndex={-1}>
      <nav aria-label="Breadcrumb">
        <ol>
          <li>
            <Link href="/organizations">Organizations</Link>
          </li>
          <li>
            <Link href={`/${organization.slug}`}>{organization.name}</Link>
          </li>
          <li aria-current="page">Entities</li>
        </ol>
      </nav>
      <h1>{organization.name} legal entities</h1>
      <p>
        <Link href={`/${organization.slug}`}>Back to organization</Link>
      </p>
      {access !== null ? (
        <p>
          Your entity scope:{' '}
          {access.entityScope.mode === 'all'
            ? 'All entities'
            : 'Selected entities'}
        </p>
      ) : null}
      {result === 'success' ? (
        <p role="status">The legal entity list was updated.</p>
      ) : null}
      {result === 'error' || failed ? (
        <p role="alert">The legal entity list could not be updated.</p>
      ) : null}
      <section aria-labelledby="entities-heading">
        <h2 id="entities-heading">Legal entities</h2>
        {entities?.length === 0 ? (
          <p>No legal entities are available.</p>
        ) : null}
        {entities !== null && entities.length > 0 ? (
          <ul>
            {entities.map((entity) => (
              <li key={entity.id}>
                <p>
                  {entity.name}, {kindLabel(entity.kind)},{' '}
                  {entity.registrationNumber ?? 'no registration number'}
                </p>
                {capabilities?.updateEntities ? (
                  <form
                    action={updateEntity}
                    aria-label={`Edit ${entity.name}`}
                  >
                    <input
                      name="legalEntityId"
                      type="hidden"
                      value={entity.id}
                    />
                    <p>
                      <label htmlFor={`entity-name-${entity.id}`}>Name</label>
                      <input
                        defaultValue={entity.name}
                        id={`entity-name-${entity.id}`}
                        maxLength={200}
                        name="name"
                        required
                      />
                    </p>
                    <p>
                      <label htmlFor={`entity-kind-${entity.id}`}>Kind</label>
                      <select
                        defaultValue={entity.kind}
                        id={`entity-kind-${entity.id}`}
                        name="kind"
                      >
                        {entityKinds.map((kind) => (
                          <option key={kind.value} value={kind.value}>
                            {kind.label}
                          </option>
                        ))}
                      </select>
                    </p>
                    <p>
                      <label htmlFor={`entity-registration-${entity.id}`}>
                        Registration number
                      </label>
                      <input
                        defaultValue={entity.registrationNumber ?? ''}
                        id={`entity-registration-${entity.id}`}
                        maxLength={32}
                        name="registrationNumber"
                        pattern="[A-Za-z0-9-]+"
                      />
                    </p>
                    <button type="submit">Save entity</button>
                  </form>
                ) : null}
                {capabilities?.deleteEntities ? (
                  <form
                    action={deleteEntity}
                    aria-label={`Delete ${entity.name}`}
                  >
                    <input
                      name="legalEntityId"
                      type="hidden"
                      value={entity.id}
                    />
                    <button type="submit">Delete entity</button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </section>
      {capabilities?.createEntities ? (
        <section aria-labelledby="create-entity-heading">
          <h2 id="create-entity-heading">Add legal entity</h2>
          <form action={createEntity} aria-label="Add legal entity">
            <p>
              <label htmlFor="new-entity-name">Name</label>
              <input
                id="new-entity-name"
                maxLength={200}
                name="name"
                required
              />
            </p>
            <p>
              <label htmlFor="new-entity-kind">Kind</label>
              <select defaultValue="company" id="new-entity-kind" name="kind">
                {entityKinds.map((kind) => (
                  <option key={kind.value} value={kind.value}>
                    {kind.label}
                  </option>
                ))}
              </select>
            </p>
            <p>
              <label htmlFor="new-entity-registration">
                Registration number
              </label>
              <input
                id="new-entity-registration"
                maxLength={32}
                name="registrationNumber"
                pattern="[A-Za-z0-9-]+"
              />
            </p>
            <button type="submit">Add entity</button>
          </form>
        </section>
      ) : null}
    </main>
  );
}
