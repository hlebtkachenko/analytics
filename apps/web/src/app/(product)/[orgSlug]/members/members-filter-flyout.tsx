'use client';

import { Button, Checkbox } from '@bap/design-system/react';

import styles from './members-view.module.scss';

export type FilterGroup = Readonly<{
  heading: string;
  items: readonly { id: string; label: string }[];
  key: string;
}>;

type MembersFilterFlyoutProps = Readonly<{
  applyLabel: string;
  groups: readonly FilterGroup[];
  idPrefix: string;
  onApply: () => void;
  onReset: () => void;
  onToggle: (groupKey: string, id: string, checked: boolean) => void;
  resetLabel: string;
  staged: Readonly<Record<string, readonly string[]>>;
}>;

// The batch-updates filter panel: category columns of checkboxes over a
// two-button footer. Selection stays staged until the caller applies it.
export function MembersFilterFlyout({
  applyLabel,
  groups,
  idPrefix,
  onApply,
  onReset,
  onToggle,
  resetLabel,
  staged,
}: MembersFilterFlyoutProps) {
  return (
    <div className={styles.filterPanel!}>
      <div className={styles.filterColumns!}>
        {groups.map((group) => (
          <div className={styles.filterColumn!} key={group.key}>
            <p className={styles.filterHeading!}>{group.heading}</p>
            <div className={styles.filterOptions!}>
              {group.items.map((item) => (
                <Checkbox
                  checked={(staged[group.key] ?? []).includes(item.id)}
                  id={`${idPrefix}-${group.key}-${item.id}`}
                  key={item.id}
                  labelText={item.label}
                  onChange={(_event, { checked }) => {
                    onToggle(group.key, item.id, checked);
                  }}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className={styles.filterFooter!}>
        <Button kind="secondary" onClick={onReset} size="lg" type="button">
          {resetLabel}
        </Button>
        <Button kind="primary" onClick={onApply} size="lg" type="button">
          {applyLabel}
        </Button>
      </div>
    </div>
  );
}
