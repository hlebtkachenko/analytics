'use client';

import {
  CheckmarkFilled,
  DotMark,
  ErrorFilled,
  WarningFilled,
} from '@bap/design-system/icons';

import styles from './status-indicator.module.scss';

// Carbon icon-indicator severities used across product status cells.
export type StatusSeverity = 'success' | 'warning' | 'error' | 'neutral';

// Explicit switch returning literal facade icons so the icon-contract scanner
// sees each tag name directly, never a variable tag.
function StatusIcon({ severity }: { severity: StatusSeverity }) {
  switch (severity) {
    case 'success':
      return (
        <CheckmarkFilled
          aria-hidden="true"
          className={styles.success!}
          focusable="false"
          size={16}
        />
      );
    case 'warning':
      return (
        <WarningFilled
          aria-hidden="true"
          className={styles.warning!}
          focusable="false"
          size={16}
        />
      );
    case 'error':
      return (
        <ErrorFilled
          aria-hidden="true"
          className={styles.error!}
          focusable="false"
          size={16}
        />
      );
    case 'neutral':
      return (
        <DotMark
          aria-hidden="true"
          className={styles.neutral!}
          focusable="false"
          size={16}
        />
      );
  }
}

// Carbon icon indicator: icon before a descriptive inline label, left-aligned.
export function StatusIndicator({
  label,
  severity,
}: {
  label: string;
  severity: StatusSeverity;
}) {
  return (
    <span className={styles.indicator!}>
      <StatusIcon severity={severity} />
      <span>{label}</span>
    </span>
  );
}
