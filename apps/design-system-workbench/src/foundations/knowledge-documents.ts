import type {
  KnowledgeDocument,
  KnowledgeDocumentSource,
} from './knowledge-search.js';

const loaders = import.meta.glob(
  '../../../../docs/design-system/knowledge-base/*.md',
  { import: 'default', query: '?raw' },
);

function filename(source: string) {
  return source.split('/').at(-1)?.replace(/\.md$/, '') ?? source;
}

function slug(value: string) {
  return value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/(^-|-$)/g, '');
}

function storyId(source: string) {
  if (filename(source) === 'source-coverage') {
    return 'knowledge-base-source-coverage-and-provenance--docs';
  }
  return `knowledge-base-${slug(filename(source))}--docs`;
}

export const knowledgeDocumentSources = Object.keys(loaders)
  .map((source) => ({
    id: slug(filename(source)),
    source,
    storyId: storyId(source),
  }))
  .sort((left, right) =>
    left.id.localeCompare(right.id),
  ) satisfies readonly KnowledgeDocumentSource[];

function documentFromSource(
  source: KnowledgeDocumentSource,
  body: string,
): KnowledgeDocument {
  const title = body.match(/^#\s+(.+)$/m)?.[1] ?? source.id;
  const headingMatches = [...body.matchAll(/^(#{2,6})\s+(.+)$/gm)];
  const sections = headingMatches.map((match, index) => {
    const heading = match[2] ?? '';
    const start = (match.index ?? 0) + match[0].length;
    const end = headingMatches[index + 1]?.index ?? body.length;
    const text = body.slice(start, end).trim();
    return {
      anchor: slug(heading),
      body: text,
      title: heading,
      url: `/?path=/docs/${source.storyId}#${slug(heading)}`,
    };
  });
  const summary =
    body
      .replace(/^#.+$/m, '')
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith('>') && !line.startsWith('#')) ??
    '';
  return {
    body,
    id: source.id,
    sections,
    summary,
    title,
    url: `/?path=/docs/${source.storyId}`,
  };
}

export async function loadKnowledgeDocuments() {
  return Promise.all(
    knowledgeDocumentSources.map(async (source) => {
      const loader = loaders[source.source];
      if (!loader)
        throw new Error(`Missing local knowledge source: ${source.source}`);
      return documentFromSource(source, String(await loader()));
    }),
  );
}
