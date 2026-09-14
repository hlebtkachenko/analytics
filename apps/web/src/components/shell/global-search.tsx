'use client';

import { HeaderPanel, Search } from '@bap/design-system/react';
import Link from 'next/link';
import { useState } from 'react';

import styles from './global-search.module.scss';

// Stub global index: real search lands with the product modules.
const stubResults = [
  { href: '/access', module: 'Access', title: 'Application access overview' },
  { href: '/organizations', module: 'Organizations', title: 'Your workspaces' },
  { href: '/datasets', module: 'Datasets', title: 'Recent datasets' },
  { href: '/datasets', module: 'Datasets', title: 'Ingest a CSV or XLSX file' },
  { href: '/account', module: 'Account', title: 'Account settings' },
] as const;

type GlobalSearchProperties = Readonly<{ expanded: boolean }>;

export default function GlobalSearch({ expanded }: GlobalSearchProperties) {
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
    <>
      {expanded ? (
        <div className={styles.field!}>
          <Search
            closeButtonLabelText="Clear search"
            labelText="Search"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search Afframe Analytics"
            size="lg"
            value={query}
          />
        </div>
      ) : null}
      <HeaderPanel aria-label="Search results" expanded={expanded}>
        {expanded ? (
          <div className={styles.results!}>
            {modules.length === 0 ? (
              <p className={styles.empty!}>No results yet.</p>
            ) : (
              modules.map((module) => (
                <section key={module}>
                  <h2 className={styles.group!}>{module}</h2>
                  <ul className={styles.list!}>
                    {matches
                      .filter((match) => match.module === module)
                      .map((match) => (
                        <li key={`${module}-${match.title}`}>
                          <Link href={match.href}>{match.title}</Link>
                        </li>
                      ))}
                  </ul>
                </section>
              ))
            )}
          </div>
        ) : null}
      </HeaderPanel>
    </>
  );
}
