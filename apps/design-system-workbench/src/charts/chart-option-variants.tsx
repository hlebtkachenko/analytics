import { Button, Search, Stack, Tile } from '@bap/design-system/react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useMemo, useRef, useState } from 'react';

import coverage from './chart-option-coverage.json';
import { CarbonChartStory, chartStoryDefinitions } from './chart-stories.js';

type ChartOptionRecord = Readonly<{
  aliasOf: string | null;
  chart: keyof typeof chartStoryDefinitions | null;
  declaration: string;
  executionStatus: 'covered' | 'excluded';
  id: string;
  localTarget: string | null;
  path: readonly string[] | null;
  property: string;
  reason: string;
  value: boolean | string;
}>;

export const chartOptionCoverage = coverage as readonly ChartOptionRecord[];
const executableRecords = chartOptionCoverage.filter(
  (record) => record.executionStatus === 'covered',
);
const excludedRecords = chartOptionCoverage.filter(
  (record) => record.executionStatus === 'excluded',
);

export function chartOptionPatch(
  path: readonly string[],
  value: boolean | string,
) {
  return path.reduceRight<unknown>(
    (patch, segment) => ({ [segment]: patch }),
    value,
  ) as Record<string, unknown>;
}

function label(record: ChartOptionRecord) {
  return `${record.declaration}.${record.property} = ${String(record.value)}`;
}

export function ChartOptionVariants() {
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(executableRecords[0]?.id ?? '');
  const parentRef = useRef<HTMLDivElement>(null);
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle
      ? executableRecords.filter((record) =>
          label(record).toLowerCase().includes(needle),
        )
      : executableRecords;
  }, [query]);
  const excludedMatches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle
      ? excludedRecords.filter((record) =>
          label(record).toLowerCase().includes(needle),
        )
      : excludedRecords;
  }, [query]);
  const selected =
    executableRecords.find((record) => record.id === selectedId) ??
    executableRecords[0] ??
    null;
  const virtualizer = useVirtualizer({
    count: matches.length,
    estimateSize: () => 44,
    getScrollElement: () => parentRef.current,
    overscan: 8,
  });

  useEffect(() => {
    const selectFragment = () => {
      const fragment = window.location.hash.slice(1);
      if (executableRecords.some((record) => record.id === fragment)) {
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

  if (!selected || !selected.chart || !selected.path) {
    return <p>No executable Carbon chart option literals are available.</p>;
  }
  const definition = chartStoryDefinitions[selected.chart];
  return (
    <Stack gap={7}>
      <section aria-label="Chart option variants">
        <Search
          id="chart-option-search"
          labelText="Search Carbon chart option literals"
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder="Search chart options"
          value={query}
        />
        <p>
          {matches.length.toLocaleString('en-US')} executable literals and{' '}
          {excludedRecords.length.toLocaleString('en-US')} reviewed exclusions
        </p>
        <div
          ref={parentRef}
          className="bap-workbench-virtual"
          role="list"
          aria-label="Chart option literals"
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
                  data-chart-option-id={record.id}
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
      <section aria-label="Excluded Carbon chart option literals">
        <p>
          {excludedMatches.length.toLocaleString('en-US')} exclusion records
        </p>
        <ul>
          {excludedMatches.map((record) => (
            <li key={record.id} data-chart-option-excluded={record.id}>
              <strong>{label(record)}</strong>: {record.reason}
            </li>
          ))}
        </ul>
      </section>
      <Tile>
        <p data-chart-option-selected={selected.id}>{label(selected)}</p>
        <p>{selected.reason}</p>
      </Tile>
      <CarbonChartStory
        definition={definition}
        optionId={selected.id}
        optionPatch={chartOptionPatch(selected.path, selected.value)}
        title={label(selected)}
      />
    </Stack>
  );
}
