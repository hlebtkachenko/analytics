// The SQL fragments and the driver error shapes every documents repository shares.

interface DatabaseError {
  code?: unknown;
  constraint?: unknown;
}

function databaseError(error: unknown): DatabaseError {
  return typeof error === 'object' && error !== null ? error : {};
}

// A named unique index is the only conflict a well-formed body can hit, so the name decides the answer.
export function isUniqueViolation(
  error: unknown,
  constraintName: string,
): boolean {
  const { code, constraint } = databaseError(error);

  return code === '23505' && constraint === constraintName;
}

// A refused value: a check constraint or a numeric overflow is bad input, never a server fault.
export function isRejectedValue(error: unknown): boolean {
  const { code } = databaseError(error);

  return code === '23514' || code === '22003';
}

// The search term is data, never pattern syntax, so the three wildcard characters are escaped before it is used.
export function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
}

// null is the absence of an entity filter; an empty array is a caller who may see nothing.
export function entityFilter(
  legalEntityIds: readonly string[] | null,
): string[] | null {
  return legalEntityIds === null ? null : [...legalEntityIds];
}
