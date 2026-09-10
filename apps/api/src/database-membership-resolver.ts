import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { readEntityScope, withTenantContext } from '@bap/db';
import { checkMigrationCompatibility, resolveMembership } from '@bap/db/access';
import { loadDatabaseConfiguration } from '@bap/db/config';
import { createDatabasePool } from '@bap/db/pool';
import type { DatabasePool } from '@bap/db/pool';
import type { EntityScope } from '@bap/security';

import { MembershipResolver } from './membership-resolver.js';
import type { TenantSelector } from './tenant-access.js';

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

  async readEntityScope(tenant: TenantSelector): Promise<EntityScope> {
    const pool = await this.getPool();
    const client = await pool.connect();

    try {
      return await withTenantContext(client, tenant, (transaction) =>
        readEntityScope(transaction, tenant),
      );
    } finally {
      client.release();
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
