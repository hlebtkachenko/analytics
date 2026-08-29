import { Search } from '@bap/design-system/react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { createElement, useMemo, useRef, useState } from 'react';
import type { ElementType, SVGProps } from 'react';

type CatalogIcon = ElementType<SVGProps<SVGSVGElement>>;
type CatalogItems = Readonly<Record<string, CatalogIcon>>;

function normalize(items: CatalogItems) {
  return Object.entries(items)
    .filter(
      ([name, Icon]) =>
        name !== 'Icon' &&
        (typeof Icon === 'function' ||
          (typeof Icon === 'object' && Icon !== null && '$$typeof' in Icon)),
    )
    .sort(([left], [right]) => left.localeCompare(right));
}

export function VirtualIconCatalog({
  iconSize = 24,
  items,
  label,
}: Readonly<{
  iconSize?: 16 | 20 | 24 | 32;
  items: CatalogItems;
  label: string;
}>) {
  const [query, setQuery] = useState('');
  const parentRef = useRef<HTMLDivElement>(null);
  const matches = useMemo(() => {
    const normalized = normalize(items);
    const needle = query.trim().toLowerCase();
    return needle
      ? normalized.filter(([name]) => name.toLowerCase().includes(needle))
      : normalized;
  }, [items, query]);
  const virtualizer = useVirtualizer({
    count: matches.length,
    estimateSize: () => iconSize + 32,
    getScrollElement: () => parentRef.current,
    overscan: 10,
  });

  return (
    <section aria-label={label}>
      <Search
        id={`${label}-search`}
        labelText={`Search ${label}`}
        onChange={(event) => setQuery(event.currentTarget.value)}
        placeholder={`Search ${label}`}
        value={query}
      />
      <p>{matches.length.toLocaleString('en-US')} results</p>
      <div
        ref={parentRef}
        className="bap-workbench-virtual"
        role="list"
        aria-label={`${label} results`}
        tabIndex={0}
      >
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            position: 'relative',
          }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const [name, Icon] = matches[virtualRow.index]!;
            return (
              <div
                key={name}
                className="bap-workbench-icon"
                role="listitem"
                style={{
                  height: `${virtualRow.size}px`,
                  position: 'absolute',
                  transform: `translateY(${virtualRow.start}px)`,
                  width: '100%',
                }}
              >
                {createElement(Icon, {
                  'aria-hidden': true,
                  height: iconSize,
                  width: iconSize,
                })}
                <code>{name}</code>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
