import { describe, expect, it } from 'vitest';

import { hashDocument, renderDatasetDocument } from './document.js';
import {
  EMBEDDING_DIMENSIONS,
  toVectorLiteral,
} from './embedding-repository.js';

function vector(fill: number): number[] {
  return Array.from({ length: EMBEDDING_DIMENSIONS }, () => fill);
}

describe('toVectorLiteral', () => {
  it('renders a bracketed literal the vector type accepts', () => {
    const literal = toVectorLiteral(vector(0.5));

    expect(literal.startsWith('[0.5,0.5')).toBe(true);
    expect(literal.endsWith(']')).toBe(true);
    expect(literal.split(',')).toHaveLength(EMBEDDING_DIMENSIONS);
  });

  it('refuses a provider answer of the wrong width', () => {
    expect(() => toVectorLiteral([1, 2, 3])).toThrow('unsupported dimension');
    expect(() => toVectorLiteral(vector(1).concat(1))).toThrow(
      'unsupported dimension',
    );
  });

  it('refuses a non-finite component', () => {
    const broken = vector(0);
    broken[0] = Number.NaN;

    expect(() => toVectorLiteral(broken)).toThrow('non-finite');
  });
});

describe('renderDatasetDocument', () => {
  it('embeds metadata only and stays deterministic', () => {
    const profile = {
      columns: 'column_a (text), column_b (number)',
      description: 'placeholder description',
      name: 'alpha container',
    };
    const document = renderDatasetDocument(profile);

    expect(document).toBe(
      'name: alpha container\ndescription: placeholder description\ncolumns: column_a (text), column_b (number)',
    );
    expect(hashDocument(document)).toBe(
      hashDocument(renderDatasetDocument(profile)),
    );
  });

  it('produces a different hash when the description changes', () => {
    const first = renderDatasetDocument({
      columns: 'column_a (text)',
      description: 'first placeholder',
      name: 'alpha container',
    });
    const second = renderDatasetDocument({
      columns: 'column_a (text)',
      description: 'second placeholder',
      name: 'alpha container',
    });

    expect(hashDocument(first)).not.toBe(hashDocument(second));
    expect(hashDocument(first)).toMatch(/^[0-9a-f]{64}$/);
  });
});
