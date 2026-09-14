'use client';

import { ActionableNotification } from '@bap/design-system/react';
import { useEffect } from 'react';

type ProductErrorProperties = Readonly<{
  error: Error & { digest?: string };
  retry: () => void;
}>;

export default function ProductError({ error, retry }: ProductErrorProperties) {
  useEffect(() => {
    // The message itself is never rendered; only a curated notice is shown.
    console.error(error);
  }, [error]);

  return (
    <ActionableNotification
      actionButtonLabel="Try again"
      kind="error"
      lowContrast
      onActionButtonClick={retry}
      subtitle="Something went wrong while loading this page."
      title="Unexpected error"
    />
  );
}
