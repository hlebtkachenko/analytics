import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { runInTenantContext, type TenantContext } from '@bap/db';
import { loadDatabaseConfiguration } from '@bap/db/config';
import { createDatabasePool, type DatabasePool } from '@bap/db/pool';
import {
  entityFilter,
  isUniqueViolation,
  isRejectedValue,
  likePattern,
} from '../documents/sql.js';
import type { EntityScopeSelector } from '../datasets/dataset-repository.js';
import type { Paged } from '../hr/hr-repository.js';
import type {
  CreateSchedule,
  CreateTimesheet,
  Schedule,
  ScheduleListQuery,
  Timesheet,
  TimesheetListQuery,
  UpdateTimesheet,
  Absence,
  AbsenceListQuery,
  CreateAbsence,
  CreateLeaveLedger,
  CreateLeaveRequest,
  CreateLeaveType,
  LeaveRequest,
  LeaveRequestListQuery,
  LeaveType,
  LeaveTypeListQuery,
  UpdateAbsence,
  UpdateLeaveType,
} from './contract.js';

export interface HrTimeScope extends TenantContext, EntityScopeSelector {}
type Tx = { query: DatabasePool['query'] };
type Row = Record<string, unknown>;
const iso = (x: unknown) =>
  x instanceof Date ? x.toISOString() : new Date(String(x)).toISOString();
const day = (x: unknown) =>
  x instanceof Date
    ? `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
    : String(x).slice(0, 10);
const scheduleCols =
  'id,legal_entity_id,employee_id,relationship_id,version,period_start,period_end,status,created_at,updated_at';
const sheetCols =
  'id,legal_entity_id,employee_id,relationship_id,period_start,period_end,version,status,submitted_at,approved_by,approved_at,rejection_reason,supersedes_timesheet_id,created_at,updated_at';
const entryCols =
  'id,work_date,started_at,ended_at,break_minutes,overtime_minutes,night_minutes,holiday_minutes,standby_minutes,activity_code,created_at,updated_at';
const visibleEmployee = async (
  tx: Tx,
  id: string,
  ids: readonly string[] | null,
) =>
  Boolean(
    (
      await tx.query(
        'select 1 from app.employee where id=$1 and ($2::uuid[] is null or legal_entity_id=any($2::uuid[]))',
        [id, entityFilter(ids)],
      )
    ).rowCount,
  );
async function audit(tx: Tx, action: string, table: string, id: string) {
  await tx.query("select app.record_audit($1,$2,$3,'{}'::jsonb)", [
    action,
    table,
    id,
  ]);
}
function entry(r: Row) {
  return {
    id: String(r.id),
    workDate: day(r.work_date),
    startedAt: iso(r.started_at),
    endedAt: iso(r.ended_at),
    breakMinutes: Number(r.break_minutes),
    overtimeMinutes: Number(r.overtime_minutes),
    nightMinutes: Number(r.night_minutes),
    holidayMinutes: Number(r.holiday_minutes),
    standbyMinutes: Number(r.standby_minutes),
    activityCode: r.activity_code === null ? null : String(r.activity_code),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}
async function schedule(tx: Tx, r: Row): Promise<Schedule> {
  const shifts = await tx.query<Row>(
    'select id,starts_at,ends_at,break_minutes,kind,created_at,updated_at from app.work_shift where schedule_id=$1 order by starts_at,id',
    [r.id],
  );
  return {
    id: String(r.id),
    legalEntityId: String(r.legal_entity_id),
    employeeId: String(r.employee_id),
    relationshipId: String(r.relationship_id),
    version: Number(r.version),
    periodStart: day(r.period_start),
    periodEnd: day(r.period_end),
    status: r.status as Schedule['status'],
    shifts: shifts.rows.map((x) => ({
      id: String(x.id),
      startsAt: iso(x.starts_at),
      endsAt: iso(x.ends_at),
      breakMinutes: Number(x.break_minutes),
      kind: x.kind as 'regular' | 'on_call',
      createdAt: iso(x.created_at),
      updatedAt: iso(x.updated_at),
    })),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}
async function timesheet(tx: Tx, r: Row): Promise<Timesheet> {
  const rows = (
    await tx.query<Row>(
      `select ${entryCols} from app.time_entry where timesheet_id=$1 order by started_at,id`,
      [r.id],
    )
  ).rows;
  const entries = rows.map(entry);
  const total = (key: keyof (typeof entries)[number]) =>
    entries.reduce((n, e) => n + Number(e[key] ?? 0), 0);
  return {
    id: String(r.id),
    legalEntityId: String(r.legal_entity_id),
    employeeId: String(r.employee_id),
    relationshipId: String(r.relationship_id),
    periodStart: day(r.period_start),
    periodEnd: day(r.period_end),
    version: Number(r.version),
    status: r.status as Timesheet['status'],
    submittedAt: r.submitted_at === null ? null : iso(r.submitted_at),
    approvedBy: r.approved_by === null ? null : String(r.approved_by),
    approvedAt: r.approved_at === null ? null : iso(r.approved_at),
    rejectionReason:
      r.rejection_reason === null ? null : String(r.rejection_reason),
    supersedesTimesheetId:
      r.supersedes_timesheet_id === null
        ? null
        : String(r.supersedes_timesheet_id),
    entries,
    totalWorkedMinutes: entries.reduce(
      (n, e) =>
        n +
        (Date.parse(e.endedAt) - Date.parse(e.startedAt)) / 60000 -
        e.breakMinutes,
      0,
    ),
    totalBreakMinutes: total('breakMinutes'),
    totalOvertimeMinutes: total('overtimeMinutes'),
    totalNightMinutes: total('nightMinutes'),
    totalHolidayMinutes: total('holidayMinutes'),
    totalStandbyMinutes: total('standbyMinutes'),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}
async function relationship(
  tx: Tx,
  employeeId: string,
  relationshipId: string,
) {
  const r = await tx.query<Row>(
    'select legal_entity_id from app.employee e join app.employment_relationship r on r.employee_id=e.id and r.organization_id=e.organization_id where e.id=$1 and r.id=$2',
    [employeeId, relationshipId],
  );
  return r.rows[0] ?? null;
}
async function addEntries(
  tx: Tx,
  id: string,
  entries: CreateTimesheet['entries'],
  user: string,
) {
  for (const e of entries)
    await tx.query(
      "insert into app.time_entry (organization_id,timesheet_id,work_date,started_at,ended_at,break_minutes,overtime_minutes,night_minutes,holiday_minutes,standby_minutes,activity_code,created_by) values (current_setting('bap.organization_id'),$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
      [
        id,
        e.workDate,
        e.startedAt,
        e.endedAt,
        e.breakMinutes,
        e.overtimeMinutes,
        e.nightMinutes,
        e.holidayMinutes,
        e.standbyMinutes,
        e.activityCode,
        user,
      ],
    );
}
async function lockVersion(
  tx: Tx,
  relationshipId: string,
  periodStart: string,
) {
  await tx.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [
    `${relationshipId}:${periodStart}`,
  ]);
}
export class HrTimeConflictError extends Error {}
export function isHrTimeConflict(e: unknown) {
  return (
    e instanceof HrTimeConflictError ||
    isUniqueViolation(e, 'work_schedule_relationship_period_version_key') ||
    isUniqueViolation(e, 'timesheet_relationship_period_version_key') ||
    isUniqueViolation(e, 'timesheet_supersedes_successor_key') ||
    isUniqueViolation(e, 'leave_type_entity_code_key') ||
    isRejectedValue(e) ||
    (typeof e === 'object' &&
      e !== null &&
      'constraint' in e &&
      [
        'time_entry_overlap_check',
        'timesheet_transition_check',
        'timesheet_immutable_check',
      ].includes(String((e as { constraint?: unknown }).constraint)))
  );
}
export abstract class HrTimeRepository {
  abstract listSchedules(
    i: HrTimeScope & { employeeId: string; query: ScheduleListQuery },
  ): Promise<Paged<Schedule> | null>;
  abstract createSchedule(
    i: HrTimeScope & { employeeId: string; body: CreateSchedule },
  ): Promise<Schedule | null>;
  abstract publish(
    i: HrTimeScope & { employeeId: string; id: string },
  ): Promise<Schedule | null>;
  abstract listTimesheets(
    i: HrTimeScope & { employeeId: string; query: TimesheetListQuery },
  ): Promise<Paged<Timesheet> | null>;
  abstract createTimesheet(
    i: HrTimeScope & { employeeId: string; body: CreateTimesheet },
  ): Promise<Timesheet | null>;
  abstract updateTimesheet(
    i: HrTimeScope & { employeeId: string; id: string; body: UpdateTimesheet },
  ): Promise<Timesheet | null>;
  abstract command(
    i: HrTimeScope & {
      employeeId: string;
      id: string;
      command: 'submit' | 'approve' | 'reject' | 'correct';
      reason?: string;
    },
  ): Promise<Timesheet | null>;
  abstract listLeaveTypes(
    i: HrTimeScope & { query: LeaveTypeListQuery },
  ): Promise<Paged<LeaveType>>;
  abstract createLeaveType(
    i: HrTimeScope & { body: CreateLeaveType },
  ): Promise<LeaveType | null>;
  abstract updateLeaveType(
    i: HrTimeScope & { id: string; body: UpdateLeaveType },
  ): Promise<LeaveType | null>;
  abstract listLeaveRequests(
    i: HrTimeScope & { employeeId: string; query: LeaveRequestListQuery },
  ): Promise<Paged<LeaveRequest> | null>;
  abstract createLeaveRequest(
    i: HrTimeScope & { employeeId: string; body: CreateLeaveRequest },
  ): Promise<LeaveRequest | null>;
  abstract leaveCommand(
    i: HrTimeScope & {
      employeeId: string;
      id: string;
      command: 'decide' | 'cancel';
      decision?: 'approved' | 'rejected';
      reason?: string;
    },
  ): Promise<LeaveRequest | null>;
  abstract leaveBalances(i: HrTimeScope & { employeeId: string }): Promise<{
    items: { leaveTypeId: string; unit: 'hours' | 'days'; balance: string }[];
  } | null>;
  abstract createLeaveLedger(
    i: HrTimeScope & { employeeId: string; body: CreateLeaveLedger },
  ): Promise<unknown | null>;
  abstract listAbsences(
    i: HrTimeScope & { employeeId: string; query: AbsenceListQuery },
  ): Promise<Paged<Absence> | null>;
  abstract createAbsence(
    i: HrTimeScope & { employeeId: string; body: CreateAbsence },
  ): Promise<Absence | null>;
  abstract updateAbsence(
    i: HrTimeScope & { employeeId: string; id: string; body: UpdateAbsence },
  ): Promise<Absence | null>;
}
@Injectable()
export class DatabaseHrTimeRepository
  extends HrTimeRepository
  implements OnModuleDestroy
{
  private poolPromise: Promise<DatabasePool> | undefined;
  async onModuleDestroy() {
    if (this.poolPromise) await (await this.poolPromise).end();
  }
  private getPool(): Promise<DatabasePool> {
    this.poolPromise ??= loadDatabaseConfiguration(process.env, {
      role: 'bap_api',
    }).then(createDatabasePool);
    return this.poolPromise;
  }
  private async inTx<T>(i: HrTimeScope, fn: (tx: Tx) => Promise<T>) {
    return runInTenantContext(await this.getPool(), i, fn);
  }
  async listSchedules(
    i: HrTimeScope & { employeeId: string; query: ScheduleListQuery },
  ) {
    return this.inTx(i, async (tx) => {
      if (!(await visibleEmployee(tx, i.employeeId, i.legalEntityIds)))
        return null;
      const q = i.query,
        p = [i.employeeId, q.to ?? null, q.from ?? null, q.status ?? null];
      const w =
        'where employee_id=$1 and ($2::date is null or period_start<=$2) and ($3::date is null or period_end>=$3) and ($4::text is null or status=$4)';
      const c = await tx.query<{ count: string }>(
        `select count(*)::text count from app.work_schedule ${w}`,
        p,
      );
      const r = await tx.query<Row>(
        `select ${scheduleCols} from app.work_schedule ${w} order by period_start desc,id asc limit $5 offset $6`,
        [...p, q.pageSize, (q.page - 1) * q.pageSize],
      );
      const items: Schedule[] = [];
      for (const row of r.rows) items.push(await schedule(tx, row));
      return {
        items,
        page: q.page,
        pageSize: q.pageSize,
        total: Number(c.rows[0]?.count ?? 0),
      };
    });
  }
  async createSchedule(
    i: HrTimeScope & { employeeId: string; body: CreateSchedule },
  ) {
    return this.inTx(i, async (tx) => {
      if (!(await visibleEmployee(tx, i.employeeId, i.legalEntityIds)))
        return null;
      const rel = await relationship(tx, i.employeeId, i.body.relationshipId);
      if (!rel) return null;
      await lockVersion(tx, i.body.relationshipId, i.body.periodStart);
      const ver = await tx.query<{ version: number }>(
        'select coalesce(max(version),0)+1 version from app.work_schedule where relationship_id=$1 and period_start=$2',
        [i.body.relationshipId, i.body.periodStart],
      );
      const r = await tx.query<Row>(
        `insert into app.work_schedule (organization_id,legal_entity_id,employee_id,relationship_id,version,period_start,period_end,created_by) values (current_setting('bap.organization_id'),$1,$2,$3,$4,$5,$6,$7) returning ${scheduleCols}`,
        [
          rel.legal_entity_id,
          i.employeeId,
          i.body.relationshipId,
          ver.rows[0]!.version,
          i.body.periodStart,
          i.body.periodEnd,
          i.userId,
        ],
      );
      for (const s of i.body.shifts)
        await tx.query(
          "insert into app.work_shift (organization_id,schedule_id,starts_at,ends_at,break_minutes,kind,created_by) values (current_setting('bap.organization_id'),$1,$2,$3,$4,$5,$6)",
          [
            r.rows[0]!.id,
            s.startsAt,
            s.endsAt,
            s.breakMinutes,
            s.kind,
            i.userId,
          ],
        );
      await audit(
        tx,
        'work_schedule.created',
        'work_schedule',
        String(r.rows[0]!.id),
      );
      return schedule(tx, r.rows[0]!);
    });
  }
  async publish(i: HrTimeScope & { employeeId: string; id: string }) {
    return this.inTx(i, async (tx) => {
      if (!(await visibleEmployee(tx, i.employeeId, i.legalEntityIds)))
        return null;
      const r = await tx.query<Row>(
        `select ${scheduleCols} from app.work_schedule where id=$1 and employee_id=$2 for update`,
        [i.id, i.employeeId],
      );
      const row = r.rows[0];
      if (!row) return null;
      if (row.status !== 'draft') throw new HrTimeConflictError();
      await tx.query(
        "update app.work_schedule set status='superseded',updated_at=now() where relationship_id=$1 and period_start=$2 and status='published'",
        [row.relationship_id, row.period_start],
      );
      const u = await tx.query<Row>(
        `update app.work_schedule set status='published',updated_at=now() where id=$1 returning ${scheduleCols}`,
        [i.id],
      );
      await audit(tx, 'work_schedule.published', 'work_schedule', i.id);
      return schedule(tx, u.rows[0]!);
    });
  }
  async listTimesheets(
    i: HrTimeScope & { employeeId: string; query: TimesheetListQuery },
  ) {
    return this.inTx(i, async (tx) => {
      if (!(await visibleEmployee(tx, i.employeeId, i.legalEntityIds)))
        return null;
      const q = i.query,
        p = [i.employeeId, q.to ?? null, q.from ?? null, q.status ?? null],
        w =
          'where employee_id=$1 and ($2::date is null or period_start<=$2) and ($3::date is null or period_end>=$3) and ($4::text is null or status=$4)';
      const c = await tx.query<{ count: string }>(
        `select count(*)::text count from app.timesheet ${w}`,
        p,
      );
      const r = await tx.query<Row>(
        `select ${sheetCols} from app.timesheet ${w} order by period_start desc,id asc limit $5 offset $6`,
        [...p, q.pageSize, (q.page - 1) * q.pageSize],
      );
      const items: Timesheet[] = [];
      for (const row of r.rows) items.push(await timesheet(tx, row));
      return {
        items,
        page: q.page,
        pageSize: q.pageSize,
        total: Number(c.rows[0]?.count ?? 0),
      };
    });
  }
  async createTimesheet(
    i: HrTimeScope & { employeeId: string; body: CreateTimesheet },
  ) {
    return this.inTx(i, async (tx) => {
      if (!(await visibleEmployee(tx, i.employeeId, i.legalEntityIds)))
        return null;
      const rel = await relationship(tx, i.employeeId, i.body.relationshipId);
      if (!rel) return null;
      await lockVersion(tx, i.body.relationshipId, i.body.periodStart);
      const v = await tx.query<{ version: number }>(
        'select coalesce(max(version),0)+1 version from app.timesheet where relationship_id=$1 and period_start=$2',
        [i.body.relationshipId, i.body.periodStart],
      );
      const r = await tx.query<Row>(
        `insert into app.timesheet (organization_id,legal_entity_id,employee_id,relationship_id,period_start,period_end,version,created_by) values (current_setting('bap.organization_id'),$1,$2,$3,$4,$5,$6,$7) returning ${sheetCols}`,
        [
          rel.legal_entity_id,
          i.employeeId,
          i.body.relationshipId,
          i.body.periodStart,
          i.body.periodEnd,
          v.rows[0]!.version,
          i.userId,
        ],
      );
      await addEntries(tx, String(r.rows[0]!.id), i.body.entries, i.userId);
      await audit(tx, 'timesheet.created', 'timesheet', String(r.rows[0]!.id));
      return timesheet(tx, r.rows[0]!);
    });
  }
  async updateTimesheet(
    i: HrTimeScope & { employeeId: string; id: string; body: UpdateTimesheet },
  ) {
    return this.inTx(i, async (tx) => {
      if (!(await visibleEmployee(tx, i.employeeId, i.legalEntityIds)))
        return null;
      const r = await tx.query<Row>(
        `select ${sheetCols} from app.timesheet where id=$1 and employee_id=$2 for update`,
        [i.id, i.employeeId],
      );
      const row = r.rows[0];
      if (!row) return null;
      if (row.status !== 'draft') throw new HrTimeConflictError();
      if (i.body.entries) {
        await tx.query('delete from app.time_entry where timesheet_id=$1', [
          i.id,
        ]);
        await addEntries(tx, i.id, i.body.entries, i.userId);
      }
      await audit(tx, 'timesheet.updated', 'timesheet', i.id);
      return timesheet(tx, row);
    });
  }
  async command(
    i: HrTimeScope & {
      employeeId: string;
      id: string;
      command: 'submit' | 'approve' | 'reject' | 'correct';
      reason?: string;
    },
  ) {
    return this.inTx(i, async (tx) => {
      if (!(await visibleEmployee(tx, i.employeeId, i.legalEntityIds)))
        return null;
      const r = await tx.query<Row>(
        `select ${sheetCols} from app.timesheet where id=$1 and employee_id=$2 for update`,
        [i.id, i.employeeId],
      );
      const row = r.rows[0];
      if (!row) return null;
      let out: Row | undefined;
      if (i.command === 'submit' && row.status === 'draft')
        out = (
          await tx.query<Row>(
            `update app.timesheet set status='submitted',submitted_at=now(),updated_at=now() where id=$1 returning ${sheetCols}`,
            [i.id],
          )
        ).rows[0];
      else if (i.command === 'approve' && row.status === 'submitted')
        out = (
          await tx.query<Row>(
            `update app.timesheet set status='approved',approved_by=$2,approved_at=now(),updated_at=now() where id=$1 returning ${sheetCols}`,
            [i.id, i.userId],
          )
        ).rows[0];
      else if (i.command === 'reject' && row.status === 'submitted')
        out = (
          await tx.query<Row>(
            `update app.timesheet set status='draft',submitted_at=null,rejection_reason=$2,updated_at=now() where id=$1 returning ${sheetCols}`,
            [i.id, i.reason],
          )
        ).rows[0];
      else if (i.command === 'correct' && row.status === 'approved') {
        await tx.query(
          "update app.timesheet set status='corrected',updated_at=now() where id=$1",
          [i.id],
        );
        const n = await tx.query<Row>(
          `insert into app.timesheet (organization_id,legal_entity_id,employee_id,relationship_id,period_start,period_end,version,rejection_reason,supersedes_timesheet_id,created_by)
           select organization_id,legal_entity_id,employee_id,relationship_id,period_start,period_end,version+1,$2,id,$3
           from app.timesheet where id=$1 and status='corrected'
           returning ${sheetCols}`,
          [i.id, i.reason, i.userId],
        );
        await tx.query(
          `insert into app.time_entry (organization_id,timesheet_id,work_date,started_at,ended_at,break_minutes,overtime_minutes,night_minutes,holiday_minutes,standby_minutes,activity_code,created_by) select organization_id,$1,work_date,started_at,ended_at,break_minutes,overtime_minutes,night_minutes,holiday_minutes,standby_minutes,activity_code,$2 from app.time_entry where timesheet_id=$3`,
          [n.rows[0]!.id, i.userId, i.id],
        );
        out = n.rows[0];
      } else throw new HrTimeConflictError();
      const action = {
        submit: 'timesheet.submitted',
        approve: 'timesheet.approved',
        reject: 'timesheet.rejected',
        correct: 'timesheet.corrected',
      } as const;
      await audit(
        tx,
        action[i.command],
        'timesheet',
        i.command === 'correct' ? String(out!.id) : i.id,
      );
      return timesheet(tx, out!);
    });
  }

  async listLeaveTypes(i: HrTimeScope & { query: LeaveTypeListQuery }) {
    return this.inTx(i, async (tx) => {
      const q = i.query;
      if (
        q.legalEntityId &&
        i.legalEntityIds &&
        !i.legalEntityIds.includes(q.legalEntityId)
      )
        return { items: [], page: q.page, pageSize: q.pageSize, total: 0 };
      const p = [
        q.legalEntityId ?? null,
        entityFilter(i.legalEntityIds),
        q.q === undefined ? null : likePattern(q.q),
        q.active ?? null,
      ];
      const w =
        "where ($1::uuid is null or legal_entity_id=$1) and ($2::uuid[] is null or legal_entity_id=any($2::uuid[])) and ($3::text is null or (code ilike $3 escape '\\' or name ilike $3 escape '\\')) and ($4::boolean is null or active=$4)";
      const count = await tx.query<{ count: string }>(
        `select count(*)::text count from app.leave_type ${w}`,
        p,
      );
      const rows = await tx.query<Row>(
        `select id,legal_entity_id,code,name,unit,paid,active,created_at,updated_at from app.leave_type ${w} order by code asc,id asc limit $5 offset $6`,
        [...p, q.pageSize, (q.page - 1) * q.pageSize],
      );
      return {
        items: rows.rows.map(leaveType),
        page: q.page,
        pageSize: q.pageSize,
        total: Number(count.rows[0]?.count ?? 0),
      };
    });
  }
  async createLeaveType(i: HrTimeScope & { body: CreateLeaveType }) {
    return this.inTx(i, async (tx) => {
      if (i.legalEntityIds && !i.legalEntityIds.includes(i.body.legalEntityId))
        return null;
      const entity = await tx.query(
        'select 1 from app.legal_entity where id=$1',
        [i.body.legalEntityId],
      );
      if (!entity.rowCount) return null;
      const r = await tx.query<Row>(
        "insert into app.leave_type (organization_id,legal_entity_id,code,name,unit,paid,created_by) values (current_setting('bap.organization_id'),$1,$2,$3,$4,$5,$6) returning id,legal_entity_id,code,name,unit,paid,active,created_at,updated_at",
        [
          i.body.legalEntityId,
          i.body.code,
          i.body.name,
          i.body.unit,
          i.body.paid,
          i.userId,
        ],
      );
      await audit(
        tx,
        'leave_type.created',
        'leave_type',
        String(r.rows[0]!.id),
      );
      return leaveType(r.rows[0]!);
    });
  }
  async updateLeaveType(
    i: HrTimeScope & { id: string; body: UpdateLeaveType },
  ) {
    return this.inTx(i, async (tx) => {
      const old = await tx.query<Row>(
        'select legal_entity_id from app.leave_type where id=$1 for update',
        [i.id],
      );
      if (
        !old.rows[0] ||
        (i.legalEntityIds &&
          !i.legalEntityIds.includes(String(old.rows[0].legal_entity_id)))
      )
        return null;
      const fields = Object.entries(i.body);
      const r = await tx.query<Row>(
        `update app.leave_type set ${fields.map((x, n) => `${camelToSnake(x[0])}=$${n + 2}`).join(',')},updated_at=now() where id=$1 returning id,legal_entity_id,code,name,unit,paid,active,created_at,updated_at`,
        [i.id, ...fields.map((x) => x[1])],
      );
      await audit(tx, 'leave_type.updated', 'leave_type', i.id);
      return leaveType(r.rows[0]!);
    });
  }
  async listLeaveRequests(
    i: HrTimeScope & { employeeId: string; query: LeaveRequestListQuery },
  ) {
    return this.inTx(i, async (tx) => {
      if (!(await visibleEmployee(tx, i.employeeId, i.legalEntityIds)))
        return null;
      const q = i.query,
        p = [
          i.employeeId,
          q.leaveTypeId ?? null,
          q.to ?? null,
          q.from ?? null,
          q.status ?? null,
        ],
        w =
          'where employee_id=$1 and ($2::uuid is null or leave_type_id=$2) and ($3::date is null or starts_on<=$3) and ($4::date is null or ends_on>=$4) and ($5::text is null or status=$5)';
      const c = await tx.query<{ count: string }>(
        `select count(*)::text count from app.leave_request ${w}`,
        p,
      );
      const r = await tx.query<Row>(
        `select ${leaveRequestCols} from app.leave_request ${w} order by starts_on desc,id asc limit $6 offset $7`,
        [...p, q.pageSize, (q.page - 1) * q.pageSize],
      );
      return {
        items: r.rows.map(leaveRequest),
        page: q.page,
        pageSize: q.pageSize,
        total: Number(c.rows[0]?.count ?? 0),
      };
    });
  }
  async createLeaveRequest(
    i: HrTimeScope & { employeeId: string; body: CreateLeaveRequest },
  ) {
    return this.inTx(i, async (tx) => {
      if (!(await visibleEmployee(tx, i.employeeId, i.legalEntityIds)))
        return null;
      const rel = await relationship(tx, i.employeeId, i.body.relationshipId);
      if (!rel) return null;
      const r = await tx.query<Row>(
        `insert into app.leave_request (organization_id,legal_entity_id,employee_id,relationship_id,leave_type_id,starts_on,ends_on,requested_amount,created_by) values (current_setting('bap.organization_id'),$1,$2,$3,$4,$5,$6,$7,$8) returning ${leaveRequestCols}`,
        [
          rel.legal_entity_id,
          i.employeeId,
          i.body.relationshipId,
          i.body.leaveTypeId,
          i.body.startsOn,
          i.body.endsOn,
          i.body.requestedAmount,
          i.userId,
        ],
      );
      await audit(
        tx,
        'leave_request.created',
        'leave_request',
        String(r.rows[0]!.id),
      );
      return leaveRequest(r.rows[0]!);
    });
  }
  async leaveCommand(
    i: HrTimeScope & {
      employeeId: string;
      id: string;
      command: 'decide' | 'cancel';
      decision?: 'approved' | 'rejected';
      reason?: string;
    },
  ) {
    return this.inTx(i, async (tx) => {
      if (!(await visibleEmployee(tx, i.employeeId, i.legalEntityIds)))
        return null;
      const r = await tx.query<Row>(
        `select ${leaveRequestCols} from app.leave_request where id=$1 and employee_id=$2 for update`,
        [i.id, i.employeeId],
      );
      const x = r.rows[0];
      if (!x) return null;
      let status: string;
      if (i.command === 'decide' && x.status === 'requested' && i.decision)
        status = i.decision;
      else if (
        i.command === 'cancel' &&
        ['requested', 'approved'].includes(String(x.status))
      )
        status = 'cancelled';
      else throw new HrTimeConflictError();
      const u = await tx.query<Row>(
        `update app.leave_request set status=$2,decided_by=$3,decided_at=now(),reason=$4,updated_at=now() where id=$1 returning ${leaveRequestCols}`,
        [i.id, status, i.userId, i.reason ?? null],
      );
      if (
        status === 'approved' ||
        (status === 'cancelled' && x.status === 'approved')
      ) {
        const amount =
          status === 'approved'
            ? `-${String(x.requested_amount)}`
            : String(x.requested_amount);
        await tx.query(
          "insert into app.leave_ledger (organization_id,legal_entity_id,employee_id,relationship_id,leave_type_id,effective_on,amount,source,source_id,created_by) values (current_setting('bap.organization_id'),$1,$2,$3,$4,$5,$6,'request',$7,$8)",
          [
            x.legal_entity_id,
            i.employeeId,
            x.relationship_id,
            x.leave_type_id,
            x.starts_on,
            amount,
            i.id,
            i.userId,
          ],
        );
      }
      await audit(
        tx,
        status === 'cancelled'
          ? 'leave_request.cancelled'
          : 'leave_request.decided',
        'leave_request',
        i.id,
      );
      return leaveRequest(u.rows[0]!);
    });
  }
  async leaveBalances(i: HrTimeScope & { employeeId: string }) {
    return this.inTx(i, async (tx) => {
      if (!(await visibleEmployee(tx, i.employeeId, i.legalEntityIds)))
        return null;
      const r = await tx.query<Row>(
        'select l.leave_type_id,t.unit,coalesce(sum(l.amount),0)::text balance from app.leave_ledger l join app.leave_type t on t.id=l.leave_type_id and t.organization_id=l.organization_id where l.employee_id=$1 group by l.leave_type_id,t.unit order by l.leave_type_id',
        [i.employeeId],
      );
      return {
        items: r.rows.map((x) => ({
          leaveTypeId: String(x.leave_type_id),
          unit: x.unit as 'hours' | 'days',
          balance: String(x.balance),
        })),
      };
    });
  }
  async createLeaveLedger(
    i: HrTimeScope & { employeeId: string; body: CreateLeaveLedger },
  ) {
    return this.inTx(i, async (tx) => {
      if (!(await visibleEmployee(tx, i.employeeId, i.legalEntityIds)))
        return null;
      const rel = await relationship(tx, i.employeeId, i.body.relationshipId);
      if (!rel) return null;
      const r = await tx.query<Row>(
        "insert into app.leave_ledger (organization_id,legal_entity_id,employee_id,relationship_id,leave_type_id,effective_on,amount,source,created_by) values (current_setting('bap.organization_id'),$1,$2,$3,$4,$5,$6,$7,$8) returning id,legal_entity_id,employee_id,relationship_id,leave_type_id,effective_on,amount,source,source_id,created_at",
        [
          rel.legal_entity_id,
          i.employeeId,
          i.body.relationshipId,
          i.body.leaveTypeId,
          i.body.effectiveOn,
          i.body.amount,
          i.body.source,
          i.userId,
        ],
      );
      await audit(
        tx,
        'leave_ledger.created',
        'leave_ledger',
        String(r.rows[0]!.id),
      );
      return leaveLedger(r.rows[0]!);
    });
  }
  async listAbsences(
    i: HrTimeScope & { employeeId: string; query: AbsenceListQuery },
  ) {
    return this.inTx(i, async (tx) => {
      if (!(await visibleEmployee(tx, i.employeeId, i.legalEntityIds)))
        return null;
      const q = i.query,
        p = [i.employeeId, q.kind ?? null, q.to ?? null, q.from ?? null],
        w =
          'where employee_id=$1 and ($2::text is null or kind=$2) and ($3::date is null or starts_on<=$3) and ($4::date is null or (ends_on is null or ends_on>=$4))',
        c = await tx.query<{ count: string }>(
          `select count(*)::text count from app.absence ${w}`,
          p,
        ),
        r = await tx.query<Row>(
          `select ${absenceCols} from app.absence ${w} order by starts_on desc,id asc limit $5 offset $6`,
          [...p, q.pageSize, (q.page - 1) * q.pageSize],
        );
      return {
        items: r.rows.map(absence),
        page: q.page,
        pageSize: q.pageSize,
        total: Number(c.rows[0]?.count ?? 0),
      };
    });
  }
  async createAbsence(
    i: HrTimeScope & { employeeId: string; body: CreateAbsence },
  ) {
    return this.writeAbsence(i, null);
  }
  async updateAbsence(
    i: HrTimeScope & { employeeId: string; id: string; body: UpdateAbsence },
  ) {
    return this.writeAbsence(i, i.id);
  }
  private async writeAbsence(
    i: HrTimeScope & {
      employeeId: string;
      body: CreateAbsence | UpdateAbsence;
    },
    id: string | null,
  ): Promise<Absence | null> {
    return this.inTx(i, async (tx) => {
      if (!(await visibleEmployee(tx, i.employeeId, i.legalEntityIds)))
        return null;
      if (id) {
        const old = await tx.query<Row>(
          `select ${absenceCols} from app.absence where id=$1 and employee_id=$2 for update`,
          [id, i.employeeId],
        );
        if (!old.rows[0]) return null;
        const merged = {
          relationshipId: String(old.rows[0].relationship_id),
          kind: String(old.rows[0].kind),
          startsOn: day(old.rows[0].starts_on),
          endsOn:
            old.rows[0].ends_on === null ? null : day(old.rows[0].ends_on),
          payrollCode: String(old.rows[0].payroll_code),
          documentId:
            old.rows[0].document_id === null
              ? null
              : String(old.rows[0].document_id),
          ...i.body,
        };
        const rel = await relationship(
          tx,
          i.employeeId,
          merged.relationshipId!,
        );
        if (!rel) return null;
        const r = await tx.query<Row>(
          `update app.absence set relationship_id=$2,kind=$3,starts_on=$4,ends_on=$5,payroll_code=$6,document_id=$7,updated_at=now() where id=$1 returning ${absenceCols}`,
          [
            id,
            merged.relationshipId,
            merged.kind,
            merged.startsOn,
            merged.endsOn,
            merged.payrollCode,
            merged.documentId,
          ],
        );
        await audit(tx, 'absence.updated', 'absence', id);
        return absence(r.rows[0]!);
      }
      const b = i.body as CreateAbsence,
        rel = await relationship(tx, i.employeeId, b.relationshipId);
      if (!rel) return null;
      const r = await tx.query<Row>(
        `insert into app.absence (organization_id,legal_entity_id,employee_id,relationship_id,kind,starts_on,ends_on,payroll_code,document_id,created_by) values (current_setting('bap.organization_id'),$1,$2,$3,$4,$5,$6,$7,$8,$9) returning ${absenceCols}`,
        [
          rel.legal_entity_id,
          i.employeeId,
          b.relationshipId,
          b.kind,
          b.startsOn,
          b.endsOn,
          b.payrollCode,
          b.documentId,
          i.userId,
        ],
      );
      await audit(tx, 'absence.created', 'absence', String(r.rows[0]!.id));
      return absence(r.rows[0]!);
    });
  }
}

const leaveRequestCols =
  'id,legal_entity_id,employee_id,relationship_id,leave_type_id,starts_on,ends_on,requested_amount,status,decided_by,decided_at,reason,created_at,updated_at';
const absenceCols =
  'id,legal_entity_id,employee_id,relationship_id,kind,starts_on,ends_on,payroll_code,document_id,created_at,updated_at';
const leaveType = (r: Row): LeaveType => ({
  id: String(r.id),
  legalEntityId: String(r.legal_entity_id),
  code: String(r.code),
  name: String(r.name),
  unit: r.unit as 'hours' | 'days',
  paid: Boolean(r.paid),
  active: Boolean(r.active),
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
});
const leaveRequest = (r: Row): LeaveRequest => ({
  id: String(r.id),
  legalEntityId: String(r.legal_entity_id),
  employeeId: String(r.employee_id),
  relationshipId: String(r.relationship_id),
  leaveTypeId: String(r.leave_type_id),
  startsOn: day(r.starts_on),
  endsOn: day(r.ends_on),
  requestedAmount: String(r.requested_amount),
  status: r.status as LeaveRequest['status'],
  decidedBy: r.decided_by === null ? null : String(r.decided_by),
  decidedAt: r.decided_at === null ? null : iso(r.decided_at),
  reason: r.reason === null ? null : String(r.reason),
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
});
const leaveLedger = (r: Row) => ({
  id: String(r.id),
  legalEntityId: String(r.legal_entity_id),
  employeeId: String(r.employee_id),
  relationshipId: String(r.relationship_id),
  leaveTypeId: String(r.leave_type_id),
  effectiveOn: day(r.effective_on),
  amount: String(r.amount),
  source: r.source as
    'opening' | 'entitlement' | 'request' | 'correction' | 'expiry',
  sourceId: r.source_id === null ? null : String(r.source_id),
  createdAt: iso(r.created_at),
});
const absence = (r: Row): Absence => ({
  id: String(r.id),
  legalEntityId: String(r.legal_entity_id),
  employeeId: String(r.employee_id),
  relationshipId: String(r.relationship_id),
  kind: r.kind as Absence['kind'],
  startsOn: day(r.starts_on),
  endsOn: r.ends_on === null ? null : day(r.ends_on),
  payrollCode: String(r.payroll_code),
  documentId: r.document_id === null ? null : String(r.document_id),
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
});
const camelToSnake = (x: string) =>
  x.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
