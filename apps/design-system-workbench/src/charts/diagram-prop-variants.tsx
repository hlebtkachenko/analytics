import {
  ArrowLeftMarker,
  ArrowRightMarker,
  CardNode,
  CardNodeColumn,
  CardNodeTitle,
  CircleMarker,
  DiamondMarker,
  Edge,
  Marker,
  ShapeNode,
  SquareMarker,
  TeeMarker,
} from '@bap/design-system/charts';
import { Button, Heading, Search, Stack, Tile } from '@bap/design-system/react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useMemo, useRef, useState } from 'react';

import coverage from './diagram-prop-coverage.json';

type DiagramPropRecord = Readonly<{
  args: Record<string, boolean | string>;
  component:
    | 'ArrowLeftMarker'
    | 'ArrowRightMarker'
    | 'CardNode'
    | 'CardNodeColumn'
    | 'CircleMarker'
    | 'DiamondMarker'
    | 'Edge'
    | 'Marker'
    | 'ShapeNode'
    | 'SquareMarker'
    | 'TeeMarker';
  executionStatus: 'covered';
  id: string;
  kind: 'declaration-literal' | 'guidance-variant';
  localTarget: string;
  property: string;
  reason: string;
  value: boolean | string;
}>;

export const diagramPropCoverage = coverage as readonly DiagramPropRecord[];
const markerComponents = {
  ArrowLeftMarker,
  ArrowRightMarker,
  CircleMarker,
  DiamondMarker,
  Marker,
  SquareMarker,
  TeeMarker,
};

function label(record: DiagramPropRecord) {
  return `${record.component}.${record.property} = ${String(record.value)}`;
}

function hostProps(tag: string | undefined) {
  return tag === 'a'
    ? { href: '#diagram-node' }
    : tag === 'button'
      ? { onClick: () => undefined }
      : {};
}

export function DiagramPropPreview({
  record,
}: Readonly<{ record: DiagramPropRecord }>) {
  const value = record.value;
  if (record.component === 'Edge') {
    return (
      <svg
        aria-label="Diagram Edge literal"
        height="100"
        role="img"
        width="300"
      >
        <Edge
          source={{ x: 30, y: 50 }}
          target={{ x: 260, y: 50 }}
          variant={value as string}
        />
      </svg>
    );
  }
  if (record.component === 'ShapeNode') {
    const tag =
      record.property === 'tag' ? (value as 'a' | 'button' | 'div') : 'div';
    return (
      <ShapeNode
        {...hostProps(tag)}
        bodyPosition={
          record.property === 'bodyPosition' ? (value as 'absolute') : 'static'
        }
        position={
          record.property === 'position' ? (value as 'absolute') : 'relative'
        }
        renderIcon={<span aria-hidden>●</span>}
        shape={
          record.property === 'shape'
            ? (value as 'circle' | 'rounded-square' | 'square')
            : 'circle'
        }
        stacked={record.property === 'stacked' ? (value as boolean) : false}
        tag={tag}
        title="Neutral shape node"
      />
    );
  }
  if (record.component === 'CardNode') {
    const tag =
      record.property === 'tag' ? (value as 'a' | 'button' | 'div') : 'div';
    return (
      <CardNode
        {...hostProps(tag)}
        position={
          record.property === 'position' ? (value as 'absolute') : 'relative'
        }
        stacked={record.property === 'stacked' ? (value as boolean) : false}
        tag={tag}
      >
        <CardNodeTitle>Neutral card node</CardNodeTitle>
      </CardNode>
    );
  }
  if (record.component === 'CardNodeColumn') {
    return (
      <CardNode>
        <CardNodeColumn farsideColumn={value as boolean}>
          Neutral column
        </CardNodeColumn>
      </CardNode>
    );
  }
  const markerId = `marker-${record.component}-${String(value)}`;
  const MarkerComponent =
    markerComponents[record.component as keyof typeof markerComponents];
  return (
    <svg
      aria-label="Diagram marker literal"
      height="100"
      role="img"
      width="300"
    >
      <defs>
        <MarkerComponent id={markerId} position={value as 'end' | 'start'} />
      </defs>
      <path
        d="M30 50H260"
        {...(value === 'start'
          ? { markerStart: `url(#${markerId})` }
          : { markerEnd: `url(#${markerId})` })}
        stroke="currentColor"
        strokeWidth="2"
      />
    </svg>
  );
}

export function DiagramPropVariants() {
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(
    diagramPropCoverage[0]?.id ?? '',
  );
  const parentRef = useRef<HTMLDivElement>(null);
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle
      ? diagramPropCoverage.filter((record) =>
          label(record).toLowerCase().includes(needle),
        )
      : diagramPropCoverage;
  }, [query]);
  const selected =
    matches.find((record) => record.id === selectedId) ?? matches[0] ?? null;
  const virtualizer = useVirtualizer({
    count: matches.length,
    estimateSize: () => 44,
    getScrollElement: () => parentRef.current,
    overscan: 8,
  });

  useEffect(() => {
    const selectFragment = () => {
      const fragment = window.location.hash.slice(1);
      if (diagramPropCoverage.some((record) => record.id === fragment)) {
        setSelectedId(fragment);
      }
    };
    selectFragment();
    window.addEventListener('hashchange', selectFragment);
    return () => window.removeEventListener('hashchange', selectFragment);
  }, []);

  function selectRecord(id: string) {
    setSelectedId(id);
    window.history.replaceState(null, '', `#${id}`);
  }

  if (!selected)
    return <p>No executable Carbon diagram prop literals exist.</p>;
  return (
    <Stack gap={7}>
      <Heading>Diagram prop literals</Heading>
      <section aria-label="Diagram prop variants">
        <Search
          id="diagram-prop-search"
          labelText="Search Carbon diagram prop literals"
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder="Search diagram props"
          value={query}
        />
        <p>{matches.length.toLocaleString('en-US')} executable literals</p>
        <div
          ref={parentRef}
          className="bap-workbench-virtual"
          role="list"
          aria-label="Diagram prop literals"
          tabIndex={0}
        >
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              position: 'relative',
            }}
          >
            {virtualizer.getVirtualItems().map((row) => {
              const record = matches[row.index];
              if (!record) return null;
              return (
                <div
                  key={record.id}
                  id={record.id}
                  data-diagram-prop-id={record.id}
                  role="listitem"
                  style={{
                    height: `${row.size}px`,
                    position: 'absolute',
                    transform: `translateY(${row.start}px)`,
                    width: '100%',
                  }}
                >
                  <Button
                    kind={record.id === selected.id ? 'primary' : 'ghost'}
                    onClick={() => selectRecord(record.id)}
                    size="sm"
                  >
                    {label(record)}
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      </section>
      <Tile>
        <p data-diagram-prop-selected={selected.id}>{label(selected)}</p>
        <p>{selected.reason}</p>
      </Tile>
      <div
        data-diagram-prop-preview={selected.id}
        id={`preview-${selected.id}`}
      >
        <DiagramPropPreview record={selected} />
      </div>
    </Stack>
  );
}
