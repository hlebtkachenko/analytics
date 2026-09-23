import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { runInTenantContext } from '@bap/db';
import type { TenantContext } from '@bap/db';
import { loadDatabaseConfiguration } from '@bap/db/config';
import { createDatabasePool } from '@bap/db/pool';
import type { DatabasePool } from '@bap/db/pool';

import { MAX_PARTNER_LIST_SIZE } from './contract.js';
import type { InvoiceLineCategory, Partner } from './contract.js';
import { entityFilter, isUniqueViolation, likePattern } from './sql.js';

export interface ListPartnersInput extends TenantContext {
  legalEntityIds: readonly string[] | null;
  q: string | undefined;
}

export interface CreatePartnerInput extends TenantContext {
  countryCode: string | null;
  defaultLineCategory: InvoiceLineCategory | null;
  // null is the absence of an intercompany link; the composite foreign key pins the entity to this organization.
  legalEntityId: string | null;
  legalEntityIds: readonly string[] | null;
  name: string;
  registrationNumber: string | null;
  vatNumber: string | null;
}

export interface UpdatePartnerInput extends TenantContext {
  countryCode: string | null | undefined;
  defaultLineCategory: InvoiceLineCategory | null | undefined;
  legalEntityId: string | null | undefined;
  legalEntityIds: readonly string[] | null;
  name: string | undefined;
  partnerId: string;
  registrationNumber: string | null | undefined;
  vatNumber: string | null | undefined;
}

interface PartnerRow {
  country_code: string | null;
  created_at: Date;
  default_line_category: InvoiceLineCategory | null;
  id: string;
  legal_entity_id: string | null;
  name: string;
  registration_number: string | null;
  updated_at: Date;
  vat_number: string | null;
}

// A partner is organization wide, so it stays visible; only an intercompany entity outside the scope is masked away.
function partnerColumns(entityFilterParameter: string): string {
  return `id, name, registration_number, vat_number, country_code, default_line_category,
          case when ${entityFilterParameter}::uuid[] is null
                    or legal_entity_id = any(${entityFilterParameter}::uuid[])
               then legal_entity_id
          end as legal_entity_id,
          created_at, updated_at`;
}

function toPartner(row: PartnerRow): Partner {
  return {
    countryCode: row.country_code,
    createdAt: row.created_at.toISOString(),
    defaultLineCategory: row.default_line_category,
    id: row.id,
    legalEntityId: row.legal_entity_id,
    name: row.name,
    registrationNumber: row.registration_number,
    updatedAt: row.updated_at.toISOString(),
    vatNumber: row.vat_number,
  };
}

// The partial unique index on (organization_id, registration_number) is the only conflict a well-formed body can hit.
export function isDuplicatePartnerRegistration(error: unknown): boolean {
  return isUniqueViolation(error, 'partner_registration_number_key');
}

export async function listPartners(
  pool: DatabasePool,
  input: ListPartnersInput,
): Promise<Partner[]> {
  return runInTenantContext(pool, input, async (transaction) => {
    const result = await transaction.query<PartnerRow>(
      `select ${partnerColumns('$3')}
       from app.partner
       where ($1::text is null
              or name ilike $1
              or registration_number ilike $1
              or vat_number ilike $1)
       order by lower(name), id
       limit $2`,
      [
        input.q === undefined ? null : likePattern(input.q),
        MAX_PARTNER_LIST_SIZE,
        entityFilter(input.legalEntityIds),
      ],
    );

    return result.rows.map(toPartner);
  });
}

// Returns null when the requested intercompany entity is absent or out of scope, so a restricted caller learns nothing.
export async function createPartner(
  pool: DatabasePool,
  input: CreatePartnerInput,
): Promise<Partner | null> {
  return runInTenantContext(pool, input, async (transaction) => {
    if (input.legalEntityId !== null) {
      const visible = await transaction.query(
        `select 1
         from app.legal_entity
         where id = $1 and ($2::uuid[] is null or id = any($2::uuid[]))`,
        [input.legalEntityId, entityFilter(input.legalEntityIds)],
      );

      if (visible.rowCount === 0) {
        return null;
      }
    }

    const created = await transaction.query<PartnerRow>(
      `insert into app.partner (organization_id, name, registration_number, vat_number, country_code, legal_entity_id, created_by,
                                default_line_category)
       values ($1, $2, $3, $4, $5, $6, $7, $9)
       returning ${partnerColumns('$8')}`,
      [
        input.organizationId,
        input.name,
        input.registrationNumber,
        input.vatNumber,
        input.countryCode,
        input.legalEntityId,
        input.userId,
        entityFilter(input.legalEntityIds),
        input.defaultLineCategory,
      ],
    );
    const row = created.rows[0];

    if (row === undefined) {
      throw new Error('The partner insert returned no row.');
    }

    // The audit entry records identifiers only, never the partner name or its tax numbers.
    await transaction.query(
      "select app.record_audit('partner.created', 'partner', $1, '{}'::jsonb)",
      [row.id],
    );
    return toPartner(row);
  });
}

export async function updatePartner(
  pool: DatabasePool,
  input: UpdatePartnerInput,
): Promise<Partner | null> {
  return runInTenantContext(pool, input, async (transaction) => {
    if (input.legalEntityId !== undefined && input.legalEntityId !== null) {
      const visible = await transaction.query(
        `select 1
         from app.legal_entity
         where id = $1 and ($2::uuid[] is null or id = any($2::uuid[]))`,
        [input.legalEntityId, entityFilter(input.legalEntityIds)],
      );

      if (visible.rowCount === 0) {
        return null;
      }
    }

    // A stored intercompany link the caller may not see is neither readable nor destroyable, so touching it answers like a missing partner.
    if (input.legalEntityId !== undefined) {
      const stored = await transaction.query<{ hidden: boolean }>(
        `select legal_entity_id is not null
                and $2::uuid[] is not null
                and not (legal_entity_id = any($2::uuid[])) as hidden
         from app.partner
         where id = $1`,
        [input.partnerId, entityFilter(input.legalEntityIds)],
      );

      if (stored.rows[0]?.hidden !== false) {
        return null;
      }
    }

    const updated = await transaction.query<PartnerRow>(
      `update app.partner
       set name = coalesce($2, name),
           registration_number = case when $3 then $4 else registration_number end,
           vat_number = case when $5 then $6 else vat_number end,
           country_code = case when $7 then $8 else country_code end,
           legal_entity_id = case when $9 then $10 else legal_entity_id end,
           default_line_category = case when $12 then $13 else default_line_category end,
           updated_at = now()
       where id = $1
       returning ${partnerColumns('$11')}`,
      [
        input.partnerId,
        input.name ?? null,
        input.registrationNumber !== undefined,
        input.registrationNumber ?? null,
        input.vatNumber !== undefined,
        input.vatNumber ?? null,
        input.countryCode !== undefined,
        input.countryCode ?? null,
        input.legalEntityId !== undefined,
        input.legalEntityId ?? null,
        entityFilter(input.legalEntityIds),
        input.defaultLineCategory !== undefined,
        input.defaultLineCategory ?? null,
      ],
    );
    const row = updated.rows[0];

    if (row === undefined) {
      return null;
    }

    await transaction.query(
      "select app.record_audit('partner.updated', 'partner', $1, '{}'::jsonb)",
      [row.id],
    );
    return toPartner(row);
  });
}

export abstract class PartnerRepository {
  abstract createPartner(input: CreatePartnerInput): Promise<Partner | null>;
  abstract listPartners(input: ListPartnersInput): Promise<Partner[]>;
  abstract updatePartner(input: UpdatePartnerInput): Promise<Partner | null>;
}

@Injectable()
export class DatabasePartnerRepository
  extends PartnerRepository
  implements OnModuleDestroy
{
  private poolPromise: Promise<DatabasePool> | undefined;

  async createPartner(input: CreatePartnerInput): Promise<Partner | null> {
    return createPartner(await this.getPool(), input);
  }

  async listPartners(input: ListPartnersInput): Promise<Partner[]> {
    return listPartners(await this.getPool(), input);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.poolPromise !== undefined) {
      await (await this.poolPromise).end();
    }
  }

  async updatePartner(input: UpdatePartnerInput): Promise<Partner | null> {
    return updatePartner(await this.getPool(), input);
  }

  private getPool(): Promise<DatabasePool> {
    this.poolPromise ??= loadDatabaseConfiguration(process.env, {
      role: 'bap_api',
    }).then(createDatabasePool);
    return this.poolPromise;
  }
}
