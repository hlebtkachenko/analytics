import { checkMigrationCompatibility, resolveMembership } from '@bap/db/access';
import type { DatabaseConfiguration } from '@bap/db/config';
import { createDatabasePool, type DatabasePool } from '@bap/db/pool';
import { Injectable } from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';
import type { MembershipResolution } from '@bap/security';

import { MembershipResolver } from './membership-resolver.js';

@Injectable()
export class DatabaseMembershipResolver
  extends MembershipResolver
  implements OnApplicationShutdown
{
  private pool: DatabasePool | undefined;

  constructor(private readonly configuration: DatabaseConfiguration) {
    super();
  }

  async checkReadiness(): Promise<boolean> {
    try {
      const pool = this.getPool();
      await pool.query('select 1');
      const migration = await checkMigrationCompatibility(pool);
      return migration.compatible;
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

  async onApplicationShutdown(): Promise<void> {
    await this.pool?.end();
  }

  async resolve(
    subjectId: string,
    organizationId: string,
  ): Promise<MembershipResolution> {
    const membership = await resolveMembership(this.getPool(), {
      organizationId,
      subjectId,
    });

    return membership ?? { emailVerified: false, role: null };
  }

  private getPool(): DatabasePool {
    this.pool ??= createDatabasePool(this.configuration);
    return this.pool;
  }
}
