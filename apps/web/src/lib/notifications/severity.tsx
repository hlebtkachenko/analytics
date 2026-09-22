import { CheckmarkFilled, InformationFilled } from '@bap/design-system/icons';

import styles from './severity.module.scss';

export type NotificationSeverity = 'success' | 'info';

// Map a notification kind to a severity; only member.joined is a success.
export function notificationSeverity(kind: string): NotificationSeverity {
  return kind === 'member.joined' ? 'success' : 'info';
}

// Explicit switch returning literal facade icons so the icon-contract scanner
// sees each tag name directly, never a variable tag.
export function NotificationSeverityIcon({
  severity,
}: {
  severity: NotificationSeverity;
}) {
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
    case 'info':
      return (
        <InformationFilled
          aria-hidden="true"
          className={styles.info!}
          focusable="false"
          size={16}
        />
      );
  }
}
