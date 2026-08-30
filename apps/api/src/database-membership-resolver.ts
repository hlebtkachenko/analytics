import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { checkMigrationCompatibility, resolveMembership } from '@bap/db/access';
import { loadDatabaseConfiguration } from '@bap/db/config';
import { createDatabasePool } from '@bap/db/pool';
import type { DatabasePool } from '@bap/db/pool';

import { MembershipResolver } from './membership-resolver.js';

@Injectable()
export class DatabaseMembershipResolver
  extends MembershipResolver
  implements OnModuleDestroy
{
  private pool: DatabasePool | undefined;
  private poolPromise: Promise<DatabasePool> | undefined;

  async checkReadiness(): Promise<boolean> {
    try {
      const pool = await this.getPool();
      const compatibility = await checkMigrationCompatibility(pool);
      return compatibility.compatible;
    } catch {
      return false;
    }
  }

  getPoolStatistics(): { idle: number; total: number; waiting: number } {
    const pool = this.pool;

    return {
      idle: pool?.idleCount ?? 0,
      total: pool?.totalCount ?? 0,
      waiting: pool?.waitingCount ?? 0,
    };
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
    return membership ?? { emailVerified: false, role: null };
  }

  private getPool(): Promise<DatabasePool> {
    this.poolPromise ??= loadDatabaseConfiguration(process.env, {
      role: 'bap_api',
    }).then((configuration) => {
      const pool = createDatabasePool(configuration);
      this.pool = pool;
      return pool;
    });
    return this.poolPromise;
  }
}
