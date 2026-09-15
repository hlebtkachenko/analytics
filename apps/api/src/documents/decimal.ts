// Money never touches a JS number: it arrives as a string, lives as a bigint scaled by 10^4 to match numeric(19,4), and leaves as a string.

export const DECIMAL_SCALE = 4;

// The exact shape the API accepts and emits; numeric(19,4) text from pg always matches it.
export const DECIMAL_PATTERN = /^-?\d{1,15}(\.\d{1,4})?$/;

// The same shape without a sign: an amount a document carries is never negative, because direction lives in the kind.
export const NON_NEGATIVE_DECIMAL_PATTERN = /^\d{1,15}(\.\d{1,4})?$/;

const SCALE_FACTOR = 10n ** BigInt(DECIMAL_SCALE);

export const DECIMAL_ZERO = 0n;

export function parseDecimal(value: string): bigint {
  if (!DECIMAL_PATTERN.test(value)) {
    throw new Error('A decimal string must match the money contract.');
  }

  const negative = value.startsWith('-');
  const [whole = '0', fraction = ''] = (
    negative ? value.slice(1) : value
  ).split('.');
  const scaled =
    BigInt(whole) * SCALE_FACTOR + BigInt(fraction.padEnd(DECIMAL_SCALE, '0'));

  return negative ? -scaled : scaled;
}

export function formatDecimal(value: bigint): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / SCALE_FACTOR;
  const fraction = (absolute % SCALE_FACTOR)
    .toString()
    .padStart(DECIMAL_SCALE, '0');

  // Zero is never signed, so a rounded-away negative cannot print as "-0.0000".
  return `${negative && absolute !== 0n ? '-' : ''}${whole}.${fraction}`;
}

export function addDecimal(left: bigint, right: bigint): bigint {
  return left + right;
}

export function compareDecimal(left: bigint, right: bigint): number {
  if (left < right) {
    return -1;
  }

  return left > right ? 1 : 0;
}

// Half away from zero, the rounding the Czech VAT rules use: 0.005 goes to 0.01 and -0.005 to -0.01.
function divideRoundedHalfAwayFromZero(
  numerator: bigint,
  denominator: bigint,
): bigint {
  const negative = numerator < 0n !== denominator < 0n;
  const absoluteNumerator = numerator < 0n ? -numerator : numerator;
  const absoluteDenominator = denominator < 0n ? -denominator : denominator;
  const quotient = absoluteNumerator / absoluteDenominator;
  const remainder = absoluteNumerator % absoluteDenominator;
  const rounded =
    remainder * 2n >= absoluteDenominator ? quotient + 1n : quotient;

  return negative ? -rounded : rounded;
}

// base * rate / 100 rounded to 2 decimal places; both inputs are already scaled by 10^4.
export function multiplyByRatePercent(
  base: bigint,
  ratePercent: bigint,
): bigint {
  // The product carries scale 8 and the division by 100 cancels two of those digits, leaving whole hundredths.
  const hundredths = divideRoundedHalfAwayFromZero(
    base * ratePercent,
    10n ** BigInt(DECIMAL_SCALE * 2),
  );

  // The result is a whole number of hundredths, so scaling back to 10^4 is a multiplication by 100.
  return hundredths * 100n;
}
