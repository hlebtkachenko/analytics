import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { runInTenantContext, type TenantContext } from '@bap/db';
import { loadDatabaseConfiguration } from '@bap/db/config';
import { createDatabasePool, type DatabasePool } from '@bap/db/pool';

import type {
  CreateHrAccessAssignmentRequest,
  HrAccessAssignment,
} from './contract.js';

export class HrAccessAssignmentNotFoundError extends Error {}
export class HrAccessAssignmentConflictError extends Error {}
type Scope = TenantContext;
type Row = {
  id: string;
  legal_entity_id: string;
  user_id: string;
  access_role: HrAccessAssignment['accessRole'];
  created_at: Date;
};
const columns = 'id, legal_entity_id, user_id, access_role, created_at';
const toAssignment = (row: Row): HrAccessAssignment => ({
  accessRole: row.access_role,
  createdAt: row.created_at.toISOString(),
  id: row.id,
  legalEntityId: row.legal_entity_id,
  userId: row.user_id,
});

export abstract class HrAccessRepository {
  abstract create(
    input: Scope & { body: CreateHrAccessAssignmentRequest },
  ): Promise<HrAccessAssignment>;
  abstract list(input: Scope): Promise<HrAccessAssignment[]>;
  abstract remove(input: Scope & { assignmentId: string }): Promise<void>;
}

@Injectable()
export class DatabaseHrAccessRepository
  extends HrAccessRepository
  implements OnModuleDestroy
{
  private poolPromise: Promise<DatabasePool> | undefined;
  async onModuleDestroy() {
    if (this.poolPromise) await (await this.poolPromise).end();
  }
  async list(input: Scope) {
    return runInTenantContext(await this.pool(), input, async (tx) => {
      const result = await tx.query<Row>(
        `select ${columns} from app.hr_access_assignment where organization_id=$1 order by legal_entity_id asc, user_id asc, access_role asc, id asc`,
        [input.organizationId],
      );
      return result.rows.map(toAssignment);
    });
  }
  async create(input: Scope & { body: CreateHrAccessAssignmentRequest }) {
    return runInTenantContext(await this.pool(), input, async (tx) => {
      const known = await tx.query(
        'select 1 from app.legal_entity where id=$1 and organization_id=$2',
        [input.body.legalEntityId, input.organizationId],
      );
      if (!known.rowCount) throw new HrAccessAssignmentNotFoundError();
      try {
        const result = await tx.query<Row>(
          `insert into app.hr_access_assignment (organization_id, legal_entity_id, user_id, access_role, created_by) values ($1,$2,$3,$4,$5) returning ${columns}`,
          [
            input.organizationId,
            input.body.legalEntityId,
            input.body.userId,
            input.body.accessRole,
            input.userId,
          ],
        );
        const assignment = toAssignment(result.rows[0]!);
        await tx.query(
          "select app.record_audit('hr_access_assignment.created', 'hr_access_assignment', $1, '{}'::jsonb)",
          [assignment.id],
        );
        return assignment;
      } catch (error) {
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          (error as { code?: string }).code === '23505'
        )
          throw new HrAccessAssignmentConflictError();
        throw error;
      }
    });
  }
  async remove(input: Scope & { assignmentId: string }) {
    return runInTenantContext(await this.pool(), input, async (tx) => {
      const result = await tx.query<Row>(
        `delete from app.hr_access_assignment where id=$1 and organization_id=$2 returning ${columns}`,
        [input.assignmentId, input.organizationId],
      );
      const assignment = result.rows[0];
      if (!assignment) throw new HrAccessAssignmentNotFoundError();
      await tx.query(
        "select app.record_audit('hr_access_assignment.revoked', 'hr_access_assignment', $1, '{}'::jsonb)",
        [assignment.id],
      );
    });
  }
  private pool() {
    return (this.poolPromise ??= loadDatabaseConfiguration(process.env, {
      role: 'bap_api',
    }).then(createDatabasePool));
  }
}
