import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { checkMigrationCompatibility, resolveMembership } from '@bap/db/access';
import { loadDatabaseConfiguration } from '@bap/db/config';
import { createDatabasePool } from '@bap/db/pool';
import type { DatabasePool } from '@bap/db/pool';

import { MembershipResolver } from './membership-resolver.js';
import { ServiceMetrics } from './metrics.js';

@Injectable()
export class DatabaseMembershipResolver
  extends MembershipResolver
  implements OnModuleDestroy
{
  private poolPromise: Promise<DatabasePool> | undefined;

  constructor(
    @Inject(ServiceMetrics)
    private readonly metrics: ServiceMetrics,
  ) {
    super();
  }

  async checkReadiness(): Promise<boolean> {
    try {
      const pool = await this.getPool();
      const compatibility = await checkMigrationCompatibility(pool);
      this.metrics.setDatabasePoolState(pool);
      this.metrics.setMigrationCompatible(compatibility.compatible);
      return compatibility.compatible;
    } catch {
      this.metrics.setMigrationCompatible(false);
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.poolPromise !== undefined) {
      await (await this.poolPromise).end();
    }
  }

  async resolve(subjectId: string, organizationId: string) {
    const pool = await this.getPool();
    const membership = await resolveMembership(pool, {
      organizationId,
      subjectId,
    });
    this.metrics.setDatabasePoolState(pool);
    return membership ?? { emailVerified: false, role: null };
  }

  private getPool(): Promise<DatabasePool> {
    this.poolPromise ??= loadDatabaseConfiguration(process.env, {
      role: 'bap_api',
    }).then((configuration) => createDatabasePool(configuration));
    return this.poolPromise;
  }
}
