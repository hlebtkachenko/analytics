import { describe, expect, it } from 'vitest';

import {
  evaluateRules,
  ruleMatches,
  ruleReasons,
  senderMatches,
  type InboxRuleDefinition,
  type RuleFacts,
} from './rules.js';

const CHANNEL_ID = '0d3f4c2a-6e1b-4f8a-9c5d-2b7e8a1f3c4d';
const ENTITY_ID = '4a2b7c1e-9f5d-4c3a-8b21-6e0f7d5a4c39';
const OTHER_ENTITY_ID = '6c4d9e30-1b7f-4e5c-ad43-801b9f7c6e51';
const PARTNER_ID = '8e5f0a12-3c4d-4b6e-9f70-1a2b3c4d5e6f';

function rule(
  id: string,
  priority: number,
  overrides: Partial<InboxRuleDefinition> = {},
): InboxRuleDefinition {
  return {
    autoRoute: false,
    channelId: null,
    detectedType: null,
    discardReason: null,
    id,
    keyword: null,
    priority,
    senderPattern: null,
    setAssigneeId: null,
    setDocumentKind: null,
    setLegalEntityId: null,
    setPartnerId: null,
    ...overrides,
  };
}

const facts: RuleFacts = {
  channelId: CHANNEL_ID,
  detectedType: 'pdf',
  filename: 'Faktura-2026-001.pdf',
  hintText: 'Received from the supplier',
  sender: 'billing@dodavatel.cz',
  senderAuthenticated: false,
  text: null,
};

describe('senderMatches', () => {
  it('matches a full address exactly and a domain pattern by the suffix from the @', () => {
    expect(senderMatches('billing@dodavatel.cz', 'Billing@Dodavatel.cz')).toBe(
      true,
    );
    expect(senderMatches('billing@dodavatel.cz', 'other@dodavatel.cz')).toBe(
      false,
    );
    expect(senderMatches('@dodavatel.cz', 'billing@dodavatel.cz')).toBe(true);
    expect(senderMatches('@dodavatel.cz', 'billing@notdodavatel.cz')).toBe(
      false,
    );
    expect(senderMatches('@dodavatel.cz', 'x@sub.dodavatel.cz')).toBe(false);
    expect(senderMatches('@dodavatel.cz', null)).toBe(false);
  });
});

describe('ruleMatches', () => {
  it('needs every non-null condition to hold', () => {
    expect(ruleMatches(rule('a', 1, { channelId: CHANNEL_ID }), facts)).toBe(
      true,
    );
    expect(ruleMatches(rule('a', 1, { channelId: ENTITY_ID }), facts)).toBe(
      false,
    );
    expect(
      ruleMatches(
        rule('a', 1, { channelId: CHANNEL_ID, detectedType: 'image' }),
        facts,
      ),
    ).toBe(false);
    expect(ruleMatches(rule('a', 1, { detectedType: 'pdf' }), facts)).toBe(
      true,
    );
  });

  it('finds the keyword case-insensitively in the filename, the hint text and the text payload', () => {
    expect(ruleMatches(rule('a', 1, { keyword: 'faktura' }), facts)).toBe(true);
    expect(ruleMatches(rule('a', 1, { keyword: 'SUPPLIER' }), facts)).toBe(
      true,
    );
    expect(
      ruleMatches(rule('a', 1, { keyword: 'payroll' }), {
        ...facts,
        text: 'Monthly PAYROLL summary',
      }),
    ).toBe(true);
    expect(ruleMatches(rule('a', 1, { keyword: 'payroll' }), facts)).toBe(
      false,
    );
    expect(
      ruleMatches(rule('a', 1, { keyword: 'x' }), {
        ...facts,
        filename: null,
        hintText: null,
      }),
    ).toBe(false);
  });
});

describe('evaluateRules', () => {
  it('returns nothing when no rule matches', () => {
    const evaluation = evaluateRules(
      [rule('a', 1, { senderPattern: '@elsewhere.cz' })],
      facts,
    );

    expect(evaluation.matched).toEqual([]);
    expect(evaluation.discard).toBeNull();
    expect(evaluation.autoRouteRuleId).toBeNull();
    expect(Object.values(evaluation.fields).every((v) => v === null)).toBe(
      true,
    );
  });

  it('composes matching rules in priority order with first-writer-wins per field', () => {
    const evaluation = evaluateRules(
      [
        rule('kind', 3, { channelId: CHANNEL_ID, setDocumentKind: 'contract' }),
        rule('entity', 1, {
          senderPattern: '@dodavatel.cz',
          setLegalEntityId: ENTITY_ID,
        }),
        rule('later', 2, {
          detectedType: 'pdf',
          setLegalEntityId: OTHER_ENTITY_ID,
          setPartnerId: PARTNER_ID,
        }),
      ],
      facts,
    );

    expect(evaluation.matched.map((r) => r.id)).toEqual([
      'entity',
      'later',
      'kind',
    ]);
    expect(evaluation.fields).toEqual({
      assigneeId: null,
      documentKind: { ruleId: 'kind', value: 'contract' },
      legalEntityId: { ruleId: 'entity', value: ENTITY_ID },
      partnerId: { ruleId: 'later', value: PARTNER_ID },
    });
  });

  it('stops at the first discard rule and never auto-routes past it', () => {
    const evaluation = evaluateRules(
      [
        rule('first', 1, { detectedType: 'pdf', setDocumentKind: 'other' }),
        rule('discard', 2, { channelId: CHANNEL_ID, discardReason: 'spam' }),
        rule('after', 3, { detectedType: 'pdf', autoRoute: true }),
      ],
      facts,
    );

    expect(evaluation.matched.map((r) => r.id)).toEqual(['first', 'discard']);
    expect(evaluation.discard).toEqual({ reason: 'spam', ruleId: 'discard' });
    expect(evaluation.autoRouteRuleId).toBeNull();
    expect(evaluation.fields.documentKind).toEqual({
      ruleId: 'first',
      value: 'other',
    });
  });

  it('takes auto_route from the first matched rule that asks', () => {
    const evaluation = evaluateRules(
      [
        rule('quiet', 1, { detectedType: 'pdf', setAssigneeId: 'user_2' }),
        rule('auto', 2, { detectedType: 'pdf', autoRoute: true }),
        rule('auto2', 3, { detectedType: 'pdf', autoRoute: true }),
      ],
      facts,
    );

    expect(evaluation.autoRouteRuleId).toBe('auto');
    expect(evaluation.fields.assigneeId).toEqual({
      ruleId: 'quiet',
      value: 'user_2',
    });
  });
});

describe('auto-route and sender authentication', () => {
  const senderRule = rule('sender', 1, {
    autoRoute: true,
    senderPattern: '@dodavatel.cz',
    setLegalEntityId: ENTITY_ID,
  });

  it('lets a sender rule hint but not auto-route while the sender is unauthenticated', () => {
    const evaluation = evaluateRules([senderRule], facts);

    expect(evaluation.matched.map((matched) => matched.id)).toEqual(['sender']);
    expect(evaluation.fields.legalEntityId).toEqual({
      ruleId: 'sender',
      value: ENTITY_ID,
    });
    expect(evaluation.autoRouteRuleId).toBeNull();
  });

  it('lets the same rule auto-route once the sender is authenticated', () => {
    const evaluation = evaluateRules([senderRule], {
      ...facts,
      senderAuthenticated: true,
    });

    expect(evaluation.autoRouteRuleId).toBe('sender');
  });

  it('leaves a rule that matched without a sender pattern unaffected by the flag', () => {
    const channelRule = rule('channel', 1, {
      autoRoute: true,
      channelId: CHANNEL_ID,
    });

    expect(evaluateRules([channelRule], facts).autoRouteRuleId).toBe('channel');
    expect(
      evaluateRules([channelRule], { ...facts, senderAuthenticated: true })
        .autoRouteRuleId,
    ).toBe('channel');
  });

  it('falls through to the next rule that may auto-route', () => {
    const evaluation = evaluateRules(
      [senderRule, rule('type', 2, { autoRoute: true, detectedType: 'pdf' })],
      facts,
    );

    expect(evaluation.autoRouteRuleId).toBe('type');
  });
});

describe('ruleReasons', () => {
  it('writes one sentence per action naming the rule and its conditions', () => {
    const evaluation = evaluateRules(
      [
        rule('entity', 1, {
          senderPattern: '@dodavatel.cz',
          setLegalEntityId: ENTITY_ID,
        }),
        rule('kind', 2, {
          channelId: CHANNEL_ID,
          autoRoute: true,
          setDocumentKind: 'contract',
        }),
      ],
      facts,
    );
    const reasons = ruleReasons({
      applied: { documentKind: false, legalEntityId: true },
      evaluation,
    });

    expect(reasons.map((reason) => reason.evidence)).toEqual([
      `rule 1: sender @dodavatel.cz sets legal entity ${ENTITY_ID}`,
      `rule 2: channel ${CHANNEL_ID} would set kind contract, kept the earlier value`,
      `rule 2: channel ${CHANNEL_ID} routes automatically`,
    ]);
    expect(reasons.every((reason) => reason.step === 'rule')).toBe(true);
    expect(reasons.every((reason) => reason.weight === 1)).toBe(true);
  });

  it('names the discard and leaves a trace for a matched rule without an applied action', () => {
    const evaluation = evaluateRules(
      [
        rule('plain', 1, {
          detectedType: 'pdf',
          autoRoute: false,
          setAssigneeId: null,
          keyword: 'faktura',
          setPartnerId: null,
        }),
        rule('discard', 2, { detectedType: 'pdf', discardReason: 'not_ours' }),
      ],
      { ...facts, sender: null },
    );
    const reasons = ruleReasons({ applied: {}, evaluation });

    expect(reasons.map((reason) => reason.evidence)).toEqual([
      'rule 2: type pdf discards the item as not_ours',
      'rule 1: keyword "faktura", type pdf matched',
    ]);
  });
});
