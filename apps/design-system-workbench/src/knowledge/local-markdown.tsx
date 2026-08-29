import { Markdown } from '@storybook/addon-docs/blocks';
import { type ComponentProps } from 'react';

const localStoryIds: Readonly<Record<string, string>> = {
  '01-orientation.md': 'knowledge-base-01-orientation--docs',
  '02-designing.md': 'knowledge-base-02-designing--docs',
  '03-developing.md': 'knowledge-base-03-developing--docs',
  '04-foundations.md': 'knowledge-base-04-foundations--docs',
  '05-components.md': 'knowledge-base-05-components--docs',
  '06-patterns.md': 'knowledge-base-06-patterns--docs',
  '07-carbon-for-ai.md': 'knowledge-base-07-carbon-for-ai--docs',
  '08-data-visualization.md': 'knowledge-base-08-data-visualization--docs',
  '09-component-definition-of-done.md':
    'knowledge-base-09-component-definition-of-done--docs',
  '10-accessibility-i18n-content.md':
    'knowledge-base-10-accessibility-i18n-content--docs',
  '11-contribution-upgrades.md':
    'knowledge-base-11-contribution-upgrades--docs',
  'coverage-react-mdx.md': 'knowledge-base-coverage-react-mdx--docs',
  'coverage-react-stories.md': 'knowledge-base-coverage-react-stories--docs',
  'coverage-website.md': 'knowledge-base-coverage-website--docs',
  'readme.md': 'knowledge-base-readme--docs',
  'source-coverage.md': 'knowledge-base-source-coverage-and-provenance--docs',
};

export function localKnowledgeHref(href: string | undefined) {
  if (!href || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(href)) return href;
  const [source, fragment] = href.split('#', 2);
  if (!source?.toLowerCase().endsWith('.md')) return href;
  const filename = source.split('/').at(-1)?.toLowerCase();
  const storyId = filename ? localStoryIds[filename] : undefined;
  if (!storyId) return href;
  return `/?path=/docs/${storyId}${fragment ? `#${fragment}` : ''}`;
}

function LocalCode({ children, ...props }: ComponentProps<'code'>) {
  return <code {...props}>{children}</code>;
}

function LocalLink({ href, ...props }: ComponentProps<'a'>) {
  const localHref = localKnowledgeHref(href);
  return (
    <a
      {...props}
      {...(localHref !== href ? { target: '_parent' } : {})}
      href={localHref}
    />
  );
}

export function LocalMarkdown({ children }: Readonly<{ children: string }>) {
  return (
    <Markdown options={{ overrides: { a: LocalLink, code: LocalCode } }}>
      {children}
    </Markdown>
  );
}
