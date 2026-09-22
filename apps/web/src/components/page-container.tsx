import { Column, Grid, Stack } from '@bap/design-system/react';
import type { ReactNode } from 'react';

import styles from './page-container.module.scss';

type PageContainerProperties = Readonly<{
  children: ReactNode;
  condensed?: boolean;
}>;

// The single content scaffold for product pages: a Carbon grid column with a
// vertical stack. Pages compose their content inside it and never hand-roll layout.
export default function PageContainer({
  children,
  condensed = false,
}: PageContainerProperties) {
  return (
    <Grid condensed={condensed}>
      <Column sm={4} md={8} lg={16}>
        <Stack className={styles.stack!} gap={7}>
          {children}
        </Stack>
      </Column>
    </Grid>
  );
}
