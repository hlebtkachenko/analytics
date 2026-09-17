'use client';

import { Search, Theme } from '@bap/design-system/react';
import Link from 'next/link';
import { useState } from 'react';

import styles from './global-search.module.scss';

// Stub global index: real search lands with the product modules.
const stubResults = [
  {
    href: '/account/access',
    module: 'Account',
    title: 'Application access overview',
  },
  { href: '/organizations', module: 'Workspaces', title: 'Your workspaces' },
  { href: '/datasets', module: 'Datasets', title: 'Recent datasets' },
  { href: '/datasets', module: 'Datasets', title: 'Ingest a CSV or XLSX file' },
  { href: '/documents', module: 'Documents', title: 'Document register' },
  { href: '/account', module: 'Account', title: 'Account settings' },
] as const;

type GlobalSearchProperties = Readonly<{ onClose: () => void }>;

export default function GlobalSearch({ onClose }: GlobalSearchProperties) {
  const [query, setQuery] = useState('');
  const normalized = query.trim().toLowerCase();
  const matches = stubResults.filter(
    (result) =>
      normalized.length === 0 ||
      result.title.toLowerCase().includes(normalized) ||
      result.module.toLowerCase().includes(normalized),
  );
  const modules = [...new Set(matches.map((match) => match.module))];

  return (
    <Theme className={styles.field!} theme="white">
      <Search
        autoFocus
        closeButtonLabelText="Clear search"
        labelText="Search"
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            onClose();
          }
        }}
        placeholder="Search Afframe Analytics"
        size="lg"
        value={query}
      />
      <div
        aria-label="Search results"
        className={styles.results!}
        role="listbox"
      >
        {modules.length === 0 ? (
          <p className={styles.empty!}>No results.</p>
        ) : (
          modules.map((module) => (
            <div className={styles.group!} key={module}>
              <span className={styles.groupLabel!}>{module}</span>
              {matches
                .filter((match) => match.module === module)
                .map((match) => (
                  <Link
                    className={styles.result!}
                    href={{ pathname: match.href }}
                    key={`${module}-${match.title}`}
                  >
                    {match.title}
                  </Link>
                ))}
            </div>
          ))
        )}
      </div>
    </Theme>
  );
}
