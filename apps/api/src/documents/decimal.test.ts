import { describe, expect, it } from 'vitest';

import {
  addDecimal,
  compareDecimal,
  DECIMAL_PATTERN,
  DECIMAL_ZERO,
  formatDecimal,
  multiplyByRatePercent,
  NON_NEGATIVE_DECIMAL_PATTERN,
  parseDecimal,
} from './decimal.js';

describe('scaled decimal money', () => {
  it('parses every accepted shape into a bigint scaled by ten thousand', () => {
    expect(parseDecimal('0')).toBe(0n);
    expect(parseDecimal('1')).toBe(10_000n);
    expect(parseDecimal('1.5')).toBe(15_000n);
    expect(parseDecimal('1.0001')).toBe(10_001n);
    expect(parseDecimal('-1.0001')).toBe(-10_001n);
    expect(parseDecimal('-0')).toBe(0n);
    expect(parseDecimal('999999999999999.9999')).toBe(
      9_999_999_999_999_999_999n,
    );
  });

  it('rejects anything outside the money contract', () => {
    for (const value of [
      '',
      ' 1',
      '+1',
      '1.',
      '.1',
      '1.00001',
      '1,5',
      '1e3',
      'abc',
      '1000000000000000',
    ]) {
      expect(() => parseDecimal(value)).toThrow();
    }
  });

  it('refuses a sign in the non-negative money shape', () => {
    for (const value of ['0', '0.0000', '1210.0000', '999999999999999.9999']) {
      expect(NON_NEGATIVE_DECIMAL_PATTERN.test(value)).toBe(true);
    }

    for (const value of ['-0.0001', '-1', '-1210.0000']) {
      expect(DECIMAL_PATTERN.test(value)).toBe(true);
      expect(NON_NEGATIVE_DECIMAL_PATTERN.test(value)).toBe(false);
    }
  });

  it('formats back to four decimal places and never signs a zero', () => {
    expect(formatDecimal(0n)).toBe('0.0000');
    expect(formatDecimal(-0n)).toBe('0.0000');
    expect(formatDecimal(10_000n)).toBe('1.0000');
    expect(formatDecimal(-10_001n)).toBe('-1.0001');
    expect(formatDecimal(1n)).toBe('0.0001');
    expect(formatDecimal(-1n)).toBe('-0.0001');
  });

  it('round-trips every parsed value through the text form', () => {
    for (const value of ['0', '12.34', '-12.3456', '999999999999999.9999']) {
      expect(parseDecimal(formatDecimal(parseDecimal(value)))).toBe(
        parseDecimal(value),
      );
    }
  });

  it('adds and compares without a floating point step', () => {
    expect(
      formatDecimal(addDecimal(parseDecimal('0.1'), parseDecimal('0.2'))),
    ).toBe('0.3000');
    expect(compareDecimal(parseDecimal('1'), parseDecimal('2'))).toBe(-1);
    expect(compareDecimal(parseDecimal('2'), parseDecimal('1'))).toBe(1);
    expect(compareDecimal(parseDecimal('1.0000'), parseDecimal('1'))).toBe(0);
    expect(compareDecimal(DECIMAL_ZERO, parseDecimal('-0'))).toBe(0);
  });

  it('applies a VAT rate with two decimal places, rounding half away from zero', () => {
    const rate = (base: string, percent: string): string =>
      formatDecimal(
        multiplyByRatePercent(parseDecimal(base), parseDecimal(percent)),
      );

    expect(rate('1000', '21')).toBe('210.0000');
    expect(rate('1000', '21.00')).toBe('210.0000');
    expect(rate('123.45', '21')).toBe('25.9200');
    expect(rate('1000', '0')).toBe('0.0000');
    // 0.005 is the half case: it goes away from zero in both directions, never to even.
    expect(rate('0.1', '5')).toBe('0.0100');
    expect(rate('-0.1', '5')).toBe('-0.0100');
    expect(rate('0.3', '5')).toBe('0.0200');
    // 0.0049 is below the half, so it rounds down and the result is exactly zero.
    expect(rate('0.098', '5')).toBe('0.0000');
    expect(rate('-1000', '21')).toBe('-210.0000');
  });

  it('keeps the VAT result a whole number of hundredths', () => {
    for (const base of ['0.0001', '7.7777', '123.4567']) {
      expect(
        multiplyByRatePercent(parseDecimal(base), parseDecimal('21')) % 100n,
      ).toBe(0n);
    }
  });
});
