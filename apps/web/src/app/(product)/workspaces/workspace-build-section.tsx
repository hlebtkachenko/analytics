'use client';

import { ClickableTile, Link, Tag, Tile } from '@bap/design-system/react';
import { ArrowRight, Launch } from '@bap/design-system/icons';
import { useTranslation } from 'react-i18next';

import styles from './workspace-build-section.module.scss';

// The upsell advisory offerings. Placeholder marketing content; the links are
// not wired to a destination yet.
const upsellKeys = ['finance', 'tax', 'cashflow', 'audit'] as const;

// The post-login build row: a gradient hero that starts workspace creation next
// to a scrollable row of advisory upsell tiles.
export default function WorkspaceBuildSection() {
  const { t } = useTranslation();

  return (
    <section
      aria-labelledby="workspace-build-heading"
      className={styles.section!}
    >
      <h2 className={styles.visuallyHidden!} id="workspace-build-heading">
        {t('workspaces.hero.title')}
      </h2>
      <div className={styles.row!}>
        <ClickableTile className={styles.hero!} href="/workspaces/new">
          <div className={styles.heroBody!}>
            <p className={styles.heroTitle!}>{t('workspaces.hero.title')}</p>
            <p className={styles.heroSubtitle!}>
              {t('workspaces.hero.subtitle')}
            </p>
          </div>
          <span className={styles.heroCta!}>
            <ArrowRight aria-hidden="true" />
          </span>
        </ClickableTile>
        <div className={styles.upsellRow!}>
          {upsellKeys.map((key) => (
            <Tile className={styles.upsellTile!} key={key}>
              <Tag className={styles.upsellTag!} size="sm" type="purple">
                {t(`workspaces.upsell.${key}.tag`)}
              </Tag>
              <h3 className={styles.upsellTitle!}>
                {t(`workspaces.upsell.${key}.title`)}
              </h3>
              <p className={styles.upsellDescription!}>
                {t(`workspaces.upsell.${key}.description`)}
              </p>
              <Link className={styles.upsellLink!} href="#" renderIcon={Launch}>
                {t(`workspaces.upsell.${key}.learnMore`)}
              </Link>
            </Tile>
          ))}
        </div>
      </div>
    </section>
  );
}
