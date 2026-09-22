import { describe, expect, it } from 'vitest';

import {
  composeDocumentDraft,
  type DraftSourceItem,
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
