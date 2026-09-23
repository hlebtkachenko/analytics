import { describe, expect, it } from 'vitest';

import { createDocumentRequestSchema } from '../documents/contract.js';
import type { ParsedIsdocDraft } from './contract.js';
import {
  composeDocumentDraft,
  toCreateDocumentBody,
  withLineCategory,
  type DraftSourceItem,
  type ParsedLayer,
} from './draft-composer.js';
import { routingTargetFor } from './routing-targets.js';
import type { InboxRuleDefinition } from './rules.js';

const ENTITY_ID = '4a2b7c1e-9f5d-4c3a-8b21-6e0f7d5a4c39';
const RULE_ENTITY_ID = '6c4d9e30-1b7f-4e5c-ad43-801b9f7c6e51';
const PARTNER_ID = '8e5f0a12-3c4d-4b6e-9f70-1a2b3c4d5e6f';

const item: DraftSourceItem = {
  detectedType: 'pdf',
  hintKind: null,
  hintLegalEntityId: null,
  hintPartnerId: null,
  legalEntityId: null,
  primaryFilename: 'contract.pdf',
  receivedAt: '2026-09-17T08:30:00.000Z',
};

const ruleDefaults: InboxRuleDefinition = {
  autoRoute: false,
  channelId: null,
  detectedType: 'pdf',
  discardReason: null,
  id: 'rule-1',
  keyword: null,
  priority: 1,
  senderPattern: null,
  setAssigneeId: null,
  setDocumentKind: null,
  setLegalEntityId: null,
  setPartnerId: null,
};

describe('composeDocumentDraft', () => {
  it('falls back to the target kind and reports the missing entity', () => {
    const composed = composeDocumentDraft(item, [], routingTargetFor('pdf'));

    expect(composed.draft).toEqual({
      currencyCode: 'CZK',
      documentDate: '2026-09-17',
      kind: 'other',
      legalEntityId: null,
      partnerId: null,
      reference: null,
      title: 'contract.pdf',
    });
    expect(composed.missing).toEqual(['legalEntityId']);
    expect(composed.sources).toEqual({
      currency_code: 'provider',
      document_date: 'provider',
      kind: 'target_default',
      legal_entity_id: null,
      partner_id: null,
      reference: null,
      title: 'provider',
    });
  });

  it('lets the rules fill kind, entity and partner, first writer wins', () => {
    const composed = composeDocumentDraft(
      item,
      [
        { ...ruleDefaults, id: 'later', priority: 2, setDocumentKind: 'other' },
        {
          ...ruleDefaults,
          setDocumentKind: 'contract',
          setLegalEntityId: RULE_ENTITY_ID,
          setPartnerId: PARTNER_ID,
        },
      ],
      routingTargetFor('pdf'),
    );

    expect(composed.draft).toMatchObject({
      kind: 'contract',
      legalEntityId: RULE_ENTITY_ID,
      partnerId: PARTNER_ID,
    });
    expect(composed.missing).toEqual([]);
    expect(composed.sources).toMatchObject({
      kind: 'rule',
      legal_entity_id: 'rule',
      partner_id: 'rule',
    });
  });

  it('puts a hint above a rule and the item entity above a target default', () => {
    const composed = composeDocumentDraft(
      {
        ...item,
        hintKind: 'agreement',
        hintPartnerId: PARTNER_ID,
        legalEntityId: ENTITY_ID,
      },
      [
        {
          ...ruleDefaults,
          setDocumentKind: 'contract',
          setLegalEntityId: RULE_ENTITY_ID,
        },
      ],
      routingTargetFor('pdf', {
        pdf: {
          ...routingTargetFor('pdf'),
          defaultLegalEntityId: RULE_ENTITY_ID,
        },
      }),
    );

    expect(composed.draft).toMatchObject({
      kind: 'agreement',
      legalEntityId: ENTITY_ID,
      partnerId: PARTNER_ID,
    });
    expect(composed.sources).toMatchObject({
      kind: 'hint',
      legal_entity_id: 'hint',
      partner_id: 'hint',
    });
  });

  it('ignores a hint kind that is not a document kind and titles a nameless item by its type', () => {
    const composed = composeDocumentDraft(
      { ...item, hintKind: 'pdf', primaryFilename: null },
      [],
      routingTargetFor('unknown'),
    );

    expect(composed.draft.kind).toBeNull();
    expect(composed.draft.title).toBe('pdf');
    expect(composed.missing).toEqual(['kind', 'legalEntityId']);
  });

  it('adds the target required fields the draft leaves empty', () => {
    const composed = composeDocumentDraft(
      { ...item, legalEntityId: ENTITY_ID },
      [],
      routingTargetFor('pdf', {
        pdf: {
          ...routingTargetFor('pdf'),
          requiredFields: ['reference', 'title', 'legalEntityId'],
        },
      }),
    );

    expect(composed.missing).toEqual(['reference']);
  });
});

describe('composeDocumentDraft with a parsed ISDOC row', () => {
  const PARSED_ENTITY_ID = '9d1e2f30-4a5b-4c6d-8e7f-901a2b3c4d5e';
  const PARSED_PARTNER_ID = '1f2e3d4c-5b6a-4978-8a9b-0c1d2e3f4a5b';
  const invoiceTarget = routingTargetFor('isdoc_invoice');
  const invoice: NonNullable<ParsedIsdocDraft['invoice']> = {
    lines: [
      {
        baseAmount: '100.00',
        description: 'Placeholder line',
        lineKind: 'item',
        vatAmount: '21.00',
        vatMode: 'standard',
        vatRate: '21',
      },
      {
        baseAmount: '10.00',
        description: 'Advance ZF-1',
        lineKind: 'advance_deduction',
        vatAmount: '0',
        vatMode: 'outside_scope',
        vatRate: '0',
      },
    ],
    roundingAmount: '0',
  };
  const parsed: ParsedLayer = {
    draft: {
      attributes: { isdoc_document_type: '1' },
      currencyCode: 'CZK',
      documentDate: '2026-09-01',
      invoice,
      kind: 'issued_invoice',
      legalEntityId: PARSED_ENTITY_ID,
      partnerId: PARSED_PARTNER_ID,
      reference: 'FV-1',
      title: 'Placeholder Party FV-1',
    },
    legalEntityId: PARSED_ENTITY_ID,
  };
  const isdocItem = { ...item, detectedType: 'isdoc_invoice' };

  it('lets the parse outrank the target default and fill the header and the content', () => {
    const composed = composeDocumentDraft(isdocItem, [], invoiceTarget, parsed);

    expect(composed.draft).toEqual({
      currencyCode: 'CZK',
      documentDate: '2026-09-01',
      kind: 'issued_invoice',
      legalEntityId: PARSED_ENTITY_ID,
      partnerId: PARSED_PARTNER_ID,
      reference: 'FV-1',
      title: 'Placeholder Party FV-1',
    });
    expect(composed.sources).toMatchObject({
      kind: 'provider',
      legal_entity_id: 'provider',
      partner_id: 'provider',
      reference: 'provider',
    });
    expect(composed.content.invoice).toEqual(invoice);
    expect(composed.missing).toEqual([]);
  });

  it('keeps the hint and rule ahead of the parse and the target default last', () => {
    const hinted = composeDocumentDraft(
      { ...isdocItem, hintLegalEntityId: ENTITY_ID },
      [{ ...ruleDefaults, setDocumentKind: 'received_invoice' }],
      invoiceTarget,
      parsed,
    );
    const unresolved = composeDocumentDraft(isdocItem, [], invoiceTarget, {
      draft: { ...parsed.draft, kind: null, legalEntityId: null },
      legalEntityId: null,
    });

    expect(hinted.draft).toMatchObject({
      kind: 'received_invoice',
      legalEntityId: ENTITY_ID,
    });
    expect(hinted.sources).toMatchObject({
      kind: 'rule',
      legal_entity_id: 'hint',
    });
    expect(unresolved.draft.kind).toBe('received_invoice');
    expect(unresolved.sources.kind).toBe('target_default');
  });

  it('drops the invoice block for a hint kind that is no invoice kind', () => {
    const composed = composeDocumentDraft(
      { ...isdocItem, hintKind: 'other' },
      [],
      invoiceTarget,
      parsed,
    );
    const body = toCreateDocumentBody(composed.draft, composed.content);

    expect(composed.content.invoice).toBeNull();
    expect(body).not.toHaveProperty('invoice');
    expect(body).toMatchObject({ attributes: { isdoc_document_type: '1' } });
  });

  it('gives item lines one category and leaves deductions without one', () => {
    const composed = composeDocumentDraft(isdocItem, [], invoiceTarget, parsed);
    const filled = withLineCategory(composed.content, 'services');
    const body = createDocumentRequestSchema.safeParse(
      toCreateDocumentBody(composed.draft, filled),
    );

    expect(body.success).toBe(true);
    expect(
      (filled.invoice?.lines as { category?: string }[]).map(
        (line) => line.category,
      ),
    ).toEqual(['services', undefined]);
    expect(withLineCategory(composed.content, null)).toBe(composed.content);
  });
});
