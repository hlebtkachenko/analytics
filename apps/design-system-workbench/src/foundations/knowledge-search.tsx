import MiniSearch from 'minisearch';
import { Search } from '@bap/design-system/react';
import { useMemo, useState } from 'react';

import { LocalMarkdown } from '../knowledge/local-markdown.js';

export type KnowledgeSection = Readonly<{
  anchor: string;
  body: string;
  title: string;
  url: string;
}>;

export type KnowledgeDocument = Readonly<{
  body: string;
  id: string;
  sections: readonly KnowledgeSection[];
  summary: string;
  title: string;
  url: string;
}>;

export type KnowledgeDocumentSource = Readonly<{
  id: string;
  source: string;
  storyId: string;
}>;

type SearchEntry = Readonly<{
  body: string;
  id: string;
  summary: string;
  title: string;
  url: string;
}>;

export function searchEntries(documents: readonly KnowledgeDocument[]) {
  const entries: SearchEntry[] = [];
  const occurrences = new Map<string, number>();
  const nextId = (base: string) => {
    const occurrence = (occurrences.get(base) ?? 0) + 1;
    occurrences.set(base, occurrence);
    return occurrence === 1 ? base : `${base}--${occurrence}`;
  };

  for (const document of documents) {
    entries.push({
      body: document.body,
      id: nextId(document.id),
      summary: document.summary,
      title: document.title,
      url: document.url,
    });
    for (const section of document.sections) {
      entries.push({
        body: section.body,
        id: nextId(`${document.id}--${section.anchor}`),
        summary: document.summary,
        title: `${document.title}: ${section.title}`,
        url: section.url,
      });
    }
  }
  return entries;
}

export function KnowledgeSearch({
  documents,
}: Readonly<{ documents: readonly KnowledgeDocument[] }>) {
  const [query, setQuery] = useState('');
  const search = useMemo(() => {
    const index = new MiniSearch<SearchEntry>({
      fields: ['title', 'summary', 'body'],
      storeFields: ['title', 'url'],
    });
    index.addAll(searchEntries(documents));
    return index;
  }, [documents]);
  const results = query.trim()
    ? search.search(query, { prefix: true }).slice(0, 12)
    : [];

  return (
    <section aria-label="Knowledge base search">
      <Search
        id="knowledge-search"
        labelText="Search local knowledge"
        onChange={(event) => setQuery(event.currentTarget.value)}
        placeholder="Search guidance, components, charts, tokens, and provenance"
        value={query}
      />
      {results.length ? (
        <ul>
          {results.map((result) => (
            <li key={result.id}>
              <a href={result.url}>{result.title}</a>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

export function LocalKnowledgeBase({
  documents,
}: Readonly<{ documents: readonly KnowledgeDocument[] }>) {
  return (
    <>
      <KnowledgeSearch documents={documents} />
      {documents.map((document) => (
        <article id={document.id} key={document.id}>
          <LocalMarkdown>{document.body}</LocalMarkdown>
        </article>
      ))}
    </>
  );
}
