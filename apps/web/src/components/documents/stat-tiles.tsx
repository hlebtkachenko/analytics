'use client';

import { Tile } from '@bap/design-system/react';
import type { ReactNode } from 'react';

import styles from './stat-tiles.module.scss';

export type StatTile = Readonly<{
  key: string;
  label: string;
  value: ReactNode;
}>;

// The read-only stat row of the documents pages: one tile per entry, number over label.
export default function StatTiles({
  ariaLabel,
  tiles,
}: Readonly<{ ariaLabel?: string; tiles: readonly StatTile[] }>) {
  return (
    <section
      className={styles.stats!}
      {...(ariaLabel === undefined ? {} : { 'aria-label': ariaLabel })}
    >
      {tiles.map((tile) => (
        <Tile key={tile.key}>
          <p className={styles.value!}>{tile.value}</p>
          <p className={styles.label!}>{tile.label}</p>
        </Tile>
      ))}
    </section>
  );
}
