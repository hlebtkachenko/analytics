import { describe, expect, it } from 'vitest';

import type { InboxExtraction, InboxRoutingTarget } from './contract.js';
import { composeDocumentDraft } from './draft-composer.js';
import type { DraftSourceItem } from './draft-composer.js';
import {
  decideAutoRoute,
  invoiceRouteBlocker,
  type AutoRouteFacts,
} from './inbox-rule-repository.js';
import type { InboxRuleDefinition } from './rules.js';
import { routingTargetFor } from './routing-targets.js';

const ENTITY_ID = '9d1e2f30-4a5b-4c6d-8e7f-901a2b3c4d5e';
const OTHER_ENTITY_ID = '4a2b7c1e-9f5d-4c3a-8b21-6e0f7d5a4c39';
const PARTNER_ID = '1f2e3d4c-5b6a-4978-8a9b-0c1d2e3f4a5b';
const OTHER_PARTNER_ID = '8e5f0a12-3c4d-4b6e-9f70-1a2b3c4d5e6f';

const target: InboxRoutingTarget = {
  ...routingTargetFor('isdoc_invoice'),
  auto: 'always',
};

const item: DraftSourceItem = {
  detectedType: 'isdoc_invoice',
  hintKind: null,
  hintLegalEntityId: null,
  hintPartnerId: null,
  legalEntityId: null,
  primaryFilename: 'invoice.isdoc',
  receivedAt: '2026-09-23T08:00:00.000Z',
};

function parsedRow(
  draft: Record<string, unknown> = {},
  legalEntityId: string | null = ENTITY_ID,
): InboxExtraction {
  return {
    confidence: 0.95,
    createdAt: '2026-09-23T08:00:01.000Z',
    detectedType: 'isdoc_invoice',
    draft: {
      attributes: { isdoc_document_type: '1' },
      currencyCode: 'CZK',
      documentDate: '2026-09-01',
      invoice: { lines: [], roundingAmount: '0' },
      kind: 'received_invoice',
      legalEntityId,
      partnerId: PARTNER_ID,
      title: 'Placeholder Party FV-1',
      ...draft,
    },
    fieldConfidences: {},
    id: '00000000-0000-4000-8000-0000000000cc',
    issues: [],
    legalEntityId,
    provider: 'isdoc',
    providerVersion: '2026-09-23.1',
    reasons: [],
  };
}

function facts(overrides: Partial<AutoRouteFacts> = {}): AutoRouteFacts {
  return {
    emailChild: false,
    issuesSinceParsed: false,
    latestIssueCount: 0,
    parsed: parsedRow(),
    senderAuthenticated: false,
    ...overrides,
  };
}

function autoRule(senderPattern: string | null): InboxRuleDefinition {
  return {
    autoRoute: true,
    channelId: null,
    detectedType: 'isdoc_invoice',
    discardReason: null,
    id: '00000000-0000-4000-8000-0000000000dd',
    keyword: null,
    priority: 1,
    senderPattern,
    setAssigneeId: null,
    setDocumentKind: null,
    setLegalEntityId: null,
    setPartnerId: null,
  };
}

function decide(
  input: {
    autoRouteRule?: InboxRuleDefinition | null;
    facts?: AutoRouteFacts;
    item?: Partial<DraftSourceItem>;
    lineCategory?: string | null;
    target?: InboxRoutingTarget;
  } = {},
) {
  const known = input.facts ?? facts();
  const composed = composeDocumentDraft(
    { ...item, ...input.item },
    [],
    input.target ?? target,
    known.parsed === null
      ? null
      : {
          draft: known.parsed.draft,
          legalEntityId: known.parsed.legalEntityId,
        },
  );

  return decideAutoRoute({
    autoRouteRule: input.autoRouteRule ?? null,
    composed,
    confidence: 0.95,
    facts: known,
    lineCategory:
      input.lineCategory === undefined ? 'services' : input.lineCategory,
    target: input.target ?? target,
  });
}

describe('decideAutoRoute', () => {
  it('routes a clean parse with the parsed entity, kind and partner and a line category', () => {
    expect(decide()).toEqual({ job: 'route', reason: null });
  });

  it('never asks when neither a rule nor the target wants it', () => {
    expect(decide({ target: { ...target, auto: 'never' } })).toEqual({
      job: null,
      reason: null,
    });
  });

  it('waits for an invoice kind without a parse, without an invoice block, or with an issue since the parse', () => {
    expect(decide({ facts: facts({ parsed: null }) }).reason).toContain(
      'clean ISDOC parse',
    );
    expect(
      decide({ facts: facts({ parsed: parsedRow({ invoice: null }) }) }).reason,
    ).toContain('clean ISDOC parse');
    expect(
      decide({ facts: facts({ issuesSinceParsed: true }) }).reason,
    ).toContain('clean ISDOC parse');
  });

  it('waits when the entity is not the parsed one, or the file named none', () => {
    expect(
      decide({ item: { hintLegalEntityId: OTHER_ENTITY_ID } }).reason,
    ).toContain('legal entity');
    expect(
      decide({
        facts: facts({ parsed: parsedRow({ kind: null }, null) }),
        target: { ...target, defaultLegalEntityId: OTHER_ENTITY_ID },
      }).reason,
    ).toContain('legal entity');
  });

  it('waits when the resolved kind is not the parsed one, so the target default never supplies a direction', () => {
    expect(decide({ item: { hintKind: 'issued_invoice' } }).reason).toContain(
      'kind is not the one',
    );
  });

  it('waits for an unresolved partner, a differing hint partner, or no line category', () => {
    expect(
      decide({ facts: facts({ parsed: parsedRow({ partnerId: null }) }) })
        .reason,
    ).toContain('resolved no partner');
    expect(
      decide({ item: { hintPartnerId: OTHER_PARTNER_ID } }).reason,
    ).toContain('partner differs');
    expect(decide({ lineCategory: null }).reason).toContain(
      'default line category',
    );
  });

  // Only a sender-bound rule with an authenticated sender routes a parsed email child, whatever its kind.
  it.each([
    ['an invoice', {}],
    [
      'a credit note',
      {
        attributes: { isdoc_document_type: '2' },
        invoice: undefined,
        kind: 'credit_note',
        totalAmount: '121',
      },
    ],
  ])(
    'routes %s from an email only through a sender-bound rule',
    (_kind, draft) => {
      const parsed = parsedRow(draft);
      const email = (senderAuthenticated: boolean) =>
        facts({ emailChild: true, parsed, senderAuthenticated });
      const neverTarget = { ...target, auto: 'never' as const };

      // Target-only auto, an authenticated sender or not.
      expect(decide({ facts: email(true) }).reason).toContain(
        'sender-bound rule',
      );
      expect(decide({ facts: email(false) }).reason).toContain(
        'sender-bound rule',
      );
      // A rule with no sender pattern.
      expect(
        decide({
          autoRouteRule: autoRule(null),
          facts: email(true),
          target: neverTarget,
        }).reason,
      ).toContain('sender-bound rule');
      // A sender-bound rule with an unauthenticated sender.
      expect(
        decide({
          autoRouteRule: autoRule('@supplier.test'),
          facts: email(false),
          target: neverTarget,
        }).reason,
      ).toContain('sender-bound rule');
      // A sender-bound rule with an authenticated sender is the one way through.
      expect(
        decide({
          autoRouteRule: autoRule('@supplier.test'),
          facts: email(true),
          target: neverTarget,
        }),
      ).toEqual({ job: 'route', reason: null });
      // Uploads and API items keep the target default guard.
      expect(decide({ facts: facts({ parsed }) })).toEqual({
        job: 'route',
        reason: null,
      });
    },
  );

  it('never routes an advance tax document', () => {
    const advance = parsedRow({
      attributes: { isdoc_document_type: '5' },
      invoice: undefined,
      kind: 'advance_request',
    });

    expect(decide({ facts: facts({ parsed: advance }) }).reason).toContain(
      'advance tax document',
    );
  });

  it('keeps the destination and missing-field waits for every kind', () => {
    expect(
      decide({ target: { ...target, destination: 'datasets' } }).reason,
    ).toContain('documents destination');
    expect(
      decide({
        facts: facts({ parsed: null }),
        item: { detectedType: 'pdf' },
        target: { ...routingTargetFor('pdf'), auto: 'always' },
      }).reason,
    ).toContain('missing legalEntityId');
  });
});

describe('invoiceRouteBlocker', () => {
  function block(
    input: {
      facts?: AutoRouteFacts;
      item?: Partial<DraftSourceItem>;
    } = {},
  ) {
    const known = input.facts ?? facts();
    const composed = composeDocumentDraft(
      { ...item, ...input.item },
      [],
      target,
      known.parsed === null
        ? null
        : {
            draft: known.parsed.draft,
            legalEntityId: known.parsed.legalEntityId,
          },
    );

    return invoiceRouteBlocker({
      asker: { kind: 'person' },
      composed,
      facts: known,
      lineCategory: 'services',
    });
  }

  it('lets a person file a clean parse, but not one with issues or another entity or partner', () => {
    expect(block()).toBeNull();
    expect(block({ facts: facts({ issuesSinceParsed: true }) })).toContain(
      'clean ISDOC parse',
    );
    expect(block({ item: { hintLegalEntityId: OTHER_ENTITY_ID } })).toContain(
      'legal entity',
    );
    expect(block({ item: { hintPartnerId: OTHER_PARTNER_ID } })).toContain(
      'partner differs',
    );
  });

  it('never asks a person for a sender binding', () => {
    expect(
      block({ facts: facts({ emailChild: true, senderAuthenticated: false }) }),
    ).toBeNull();
  });
});
