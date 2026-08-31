import { Column, Grid } from '@bap/design-system/react';
import type { ReactNode } from 'react';

import styles from './layout.module.scss';

type IdentityLayoutProperties = Readonly<{
  children: ReactNode;
}>;

export default function IdentityLayout({ children }: IdentityLayoutProperties) {
  return (
    <Grid>
      <Column
        className={styles.content!}
        sm={4}
        md={{ span: 6, offset: 1 }}
        lg={{ span: 6, offset: 5 }}
      >
        {children}
      </Column>
    </Grid>
  );
}
