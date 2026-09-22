'use client';

import { Search, Theme } from '@bap/design-system/react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import {
  getJson,
  isAbortError,
  legalEntitiesPath,
  legalEntityListSchema,
} from '../../lib/datasets/client';
import type { ActiveOrganizationValue } from './active-organization';
import styles from './global-search.module.scss';
import { organizationsSchema } from './header-panels';
import { railDestinations, workspaceSectionItems } from './product-navigation';

type SearchKind = 'entity' | 'page' | 'workspace';

type SearchEntry = Readonly<{
  href: string;
  kind: SearchKind;
  label: string;
}>;

// The groups render in this order; each maps to one translated heading.
const groupOrder: readonly SearchKind[] = ['page', 'workspace', 'entity'];

type GlobalSearchProperties = Readonly<{
  activeOrganization?: ActiveOrganizationValue;
  onClose: () => void;
}>;

export default function GlobalSearch({
  activeOrganization,
  onClose,
}: GlobalSearchProperties) {
  const router = useRouter();
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [workspaces, setWorkspaces] = useState<
    z.infer<typeof organizationsSchema>
  >([]);
  const [entities, setEntities] = useState<readonly { name: string }[]>([]);

  // The workspace list is the same session-scoped read the switcher already makes.
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/auth/organization/list', {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : []))
      .then((payload) => setWorkspaces(organizationsSchema.parse(payload)))
      .catch(() => {});
    return () => controller.abort();
  }, []);

  // Legal entities load only for an active workspace, through the existing BFF.
  const organizationId = activeOrganization?.id;
  useEffect(() => {
    if (organizationId === undefined) {
      return;
    }
    const controller = new AbortController();
    void getJson(legalEntitiesPath(organizationId), controller.signal)
      .then((payload) => legalEntityListSchema.parse(payload))
      .then((payload) => setEntities(payload.legalEntities))
      .catch((error: unknown) => {
        if (!isAbortError(error)) {
          setEntities([]);
        }
      });
    return () => controller.abort();
  }, [organizationId]);

  const index = useMemo<readonly SearchEntry[]>(() => {
    const pages: SearchEntry[] = railDestinations.map((destination) => ({
      href: destination.href,
      kind: 'page',
      label: t(destination.labelKey),
    }));
    if (activeOrganization !== undefined) {
      for (const item of workspaceSectionItems) {
        pages.push({
          href: `/${activeOrganization.slug}/${item.segment}`,
          kind: 'page',
          label: t(item.labelKey),
        });
      }
    }
    const workspaceEntries: SearchEntry[] = workspaces.map((workspace) => ({
      href: `/${workspace.slug}`,
      kind: 'workspace',
      label: workspace.name,
    }));
    const entityEntries: SearchEntry[] =
      activeOrganization === undefined
        ? []
        : entities.map((entity) => ({
            href: `/${activeOrganization.slug}/entities`,
            kind: 'entity',
            label: entity.name,
          }));
    return [...pages, ...workspaceEntries, ...entityEntries];
  }, [activeOrganization, entities, t, workspaces]);

  const normalized = query.trim().toLowerCase();
  const matches = useMemo(
    () =>
      index.filter(
        (entry) =>
          normalized.length === 0 ||
          entry.label.toLowerCase().includes(normalized),
      ),
    [index, normalized],
  );

  // Reset the highlight when the query changes, adjusting state during render
  // rather than in an effect.
  const [highlight, setHighlight] = useState(0);
  const [trackedQuery, setTrackedQuery] = useState(normalized);
  if (normalized !== trackedQuery) {
    setTrackedQuery(normalized);
    setHighlight(0);
  }

  function navigate(entry: SearchEntry): void {
    router.push(entry.href as Route);
    onClose();
  }

  const groupLabels: Readonly<Record<SearchKind, string>> = {
    entity: t('shell.search.groupEntity'),
    page: t('shell.search.groupPage'),
    workspace: t('shell.search.groupWorkspace'),
  };

  return (
    <Theme className={styles.field!} theme="white">
      <Search
        autoFocus
        closeButtonLabelText="Clear search"
        labelText={t('shell.search.label')}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            onClose();
            return;
          }
          if (matches.length === 0) {
            return;
          }
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setHighlight((current) => (current + 1) % matches.length);
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setHighlight(
              (current) => (current - 1 + matches.length) % matches.length,
            );
          } else if (event.key === 'Enter') {
            event.preventDefault();
            const entry = matches[highlight] ?? matches[0]!;
            navigate(entry);
          }
        }}
        placeholder={t('shell.search.placeholder')}
        size="lg"
        value={query}
      />
      <div
        aria-label={t('shell.search.label')}
        className={styles.results!}
        role="listbox"
      >
        {normalized.length > 0 && matches.length === 0 ? (
          <p className={styles.empty!}>{t('shell.search.empty')}</p>
        ) : (
          groupOrder
            .filter((kind) => matches.some((match) => match.kind === kind))
            .map((kind) => (
              <div className={styles.group!} key={kind}>
                <span className={styles.groupLabel!}>{groupLabels[kind]}</span>
                {matches
                  .filter((match) => match.kind === kind)
                  .map((match) => {
                    const isActive = matches[highlight] === match;
                    return (
                      <button
                        aria-selected={isActive}
                        className={styles.result!}
                        data-active={isActive ? 'true' : undefined}
                        key={`${kind}-${match.label}-${match.href}`}
                        onClick={() => navigate(match)}
                        role="option"
                        type="button"
                      >
                        {match.label}
                      </button>
                    );
                  })}
              </div>
            ))
        )}
      </div>
    </Theme>
  );
}
