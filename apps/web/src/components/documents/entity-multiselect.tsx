'use client';

import { MultiSelect } from '@bap/design-system/react';
import { useTranslation } from 'react-i18next';

import styles from './entity-multiselect.module.scss';

// The scope the header offers; an empty selection means every entity in scope.
export type EntityOption = Readonly<{ id: string; name: string }>;

type Props = Readonly<{
  entities: readonly EntityOption[];
  onChange: (ids: readonly string[]) => void;
  selectedIds: readonly string[];
}>;

// The legal entity scope MultiSelect shared by the documents and analytics headers.
export default function EntityMultiSelect({
  entities,
  onChange,
  selectedIds,
}: Props) {
  const { t } = useTranslation();
  const items = [...entities].sort((a, b) => a.name.localeCompare(b.name));
  const selectedItems = items.filter((item) => selectedIds.includes(item.id));
  return (
    <MultiSelect
      className={styles.entitySelect!}
      hideLabel
      id="documents-entity"
      items={items}
      itemToString={(item) => item?.name ?? ''}
      label={t('documents.entityAll')}
      onChange={(change) => {
        onChange((change.selectedItems ?? []).map((item) => item.id));
      }}
      selectedItems={selectedItems}
      selectionFeedback="fixed"
      size="md"
      titleText={t('documents.entity')}
    />
  );
}
