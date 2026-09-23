import i18next from 'i18next';
import { beforeAll, describe, expect, it } from 'vitest';

import { resources } from '../../i18n/resources';
import { INBOX_DETECTED_TYPES } from './contract.ts';
import type { InboxDetectedType, InboxRoutingTarget } from './contract.ts';
import { routingSubject, routingTargetSentence } from './routing-sentence.ts';

const ENTITY_ID = '9b7d1c30-6a4b-4d1f-9c2e-7a5f0e3b8d21';
const HIDDEN_ENTITY_ID = '00000000-0000-4000-8000-000000000099';

const i18n = i18next.createInstance();
const loaded = {
  entityNames: new Map([[ENTITY_ID, 'Placeholder Holding']]),
  locale: 'en-US',
};

beforeAll(async () => {
  await i18n.init({
    interpolation: { escapeValue: false },
    lng: 'en-US',
    resources,
  });
});

const base: InboxRoutingTarget = {
  auto: 'never',
  autoThreshold: null,
  defaultAssigneeId: null,
  defaultLegalEntityId: null,
  destination: 'documents',
  detectedType: 'pdf',
  documentKind: 'other',
  partnerPolicy: 'match_only',
  requiredFields: [],
  source: 'platform',
};

function sentence(
  target: Partial<InboxRoutingTarget>,
  context: Parameters<typeof routingTargetSentence>[1] = loaded,
): string {
  return routingTargetSentence({ ...base, ...target }, context, i18n.t);
}

describe('routingTargetSentence', () => {
  it('states each of the ten platform defaults', () => {
    const platform: Record<InboxDetectedType, Partial<InboxRoutingTarget>> = {
      camt_statement: { documentKind: 'bank_statement' },
      gpc_statement: { documentKind: 'bank_statement' },
      image: {},
      isdoc_invoice: { documentKind: 'received_invoice' },
      money_s3_export: { destination: null, documentKind: null },
      pdf: {},
      pohoda_export: { destination: null, documentKind: null },
      tabular: { destination: 'datasets', documentKind: null },
      text: {},
      unknown: { destination: null, documentKind: null },
    };

    expect(
      INBOX_DETECTED_TYPES.map((detectedType) =>
        sentence({ ...platform[detectedType], detectedType }),
      ),
    ).toEqual([
      'An ISDOC invoice goes to Documents as Received invoice; a person confirms every one.',
      'A Money S3 export waits in the inbox for a person to decide.',
      'A Pohoda export waits in the inbox for a person to decide.',
      'A CAMT bank statement goes to Documents as Bank statement; a person confirms every one.',
      'A GPC bank statement goes to Documents as Bank statement; a person confirms every one.',
      'A spreadsheet or CSV file goes to Datasets; a person confirms every one.',
      'A PDF goes to Documents as Other; a person confirms every one.',
      'An image goes to Documents as Other; a person confirms every one.',
      'A text file goes to Documents as Other; a person confirms every one.',
      'Any other file waits in the inbox for a person to decide.',
    ]);
  });

  it('states the discard destination', () => {
    expect(sentence({ destination: 'discard', documentKind: null })).toBe(
      'A PDF is discarded; a person confirms every one.',
    );
  });

  it('states each confirmation branch', () => {
    expect(sentence({ auto: 'always' })).toBe(
      'A PDF goes to Documents as Other; it is filed without review.',
    );
    expect(sentence({ auto: 'above_threshold', autoThreshold: 0.9 })).toBe(
      'A PDF goes to Documents as Other; it is filed without review from 90% confidence, otherwise a person confirms it.',
    );
    expect(
      sentence({
        auto: 'always',
        destination: 'datasets',
        documentKind: null,
      }),
    ).toBe(
      'A PDF goes to Datasets; a person confirms every one, because only Documents files automatically.',
    );
    expect(
      sentence({
        auto: 'above_threshold',
        autoThreshold: 0.5,
        detectedType: 'isdoc_invoice',
        documentKind: 'received_invoice',
      }),
    ).toBe(
      'An ISDOC invoice goes to Documents as Received invoice; a person confirms every one until the ISDOC parser lands.',
    );
  });

  it('reads above threshold without a threshold as never, since the worker never asks', () => {
    expect(sentence({ auto: 'above_threshold', autoThreshold: null })).toBe(
      'A PDF goes to Documents as Other; a person confirms every one.',
    );
  });

  it('names the entity only once the entity list has loaded', () => {
    expect(sentence({ defaultLegalEntityId: ENTITY_ID })).toBe(
      'A PDF goes to Documents as Other for Placeholder Holding; a person confirms every one.',
    );
    expect(sentence({ defaultLegalEntityId: HIDDEN_ENTITY_ID })).toBe(
      'A PDF goes to Documents as Other for a hidden legal entity; a person confirms every one.',
    );
    expect(
      sentence(
        { defaultLegalEntityId: HIDDEN_ENTITY_ID },
        { entityNames: undefined, locale: 'en-US' },
      ),
    ).toBe('A PDF goes to Documents as Other; a person confirms every one.');
  });

  it('adds nothing to a target that names no destination', () => {
    expect(
      sentence({
        auto: 'always',
        defaultLegalEntityId: ENTITY_ID,
        destination: null,
        documentKind: null,
      }),
    ).toBe('A PDF waits in the inbox for a person to decide.');
  });

  it('reads a type outside the ten as any other file', () => {
    expect(sentence({ detectedType: 'spam_like' })).toBe(
      'Any other file goes to Documents as Other; a person confirms every one.',
    );
    expect(routingSubject('spam_like', 'mid', i18n.t)).toBe('any other file');
    expect(routingSubject('isdoc_invoice', 'mid', i18n.t)).toBe(
      'an ISDOC invoice',
    );
  });
});
