// The shared Czech formatters of the documents and inbox pages, built once per module.
const amountFormat = new Intl.NumberFormat('cs-CZ', {
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
});
const dateFormat = new Intl.DateTimeFormat('cs-CZ', {
  day: 'numeric',
  month: 'numeric',
  year: 'numeric',
});
const dateTimeFormat = new Intl.DateTimeFormat('cs-CZ', {
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  month: 'numeric',
  year: 'numeric',
});

// The one parsing rule: a stored yyyy-mm-dd is a calendar day in local time, so no timezone shifts it.
function localDay(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match === null
    ? undefined
    : new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

// No currency shows the bare amount; a non-number returns unchanged.
export function formatMoney(amount: string, currencyCode?: string): string {
  const value = Number(amount);
  if (!Number.isFinite(value)) {
    return amount;
  }
  const text = amountFormat.format(value);
  return currencyCode === undefined ? text : `${text} ${currencyCode}`;
}

// A month key is its first day, shown as "June 2026" in the UI language, or "Jun 2026" where space is short.
export function formatMonth(
  month: string,
  language: string,
  width: 'long' | 'short' = 'long',
): string {
  const date = localDay(month);
  return date === undefined
    ? month
    : new Intl.DateTimeFormat(language, {
        month: width,
        year: 'numeric',
      }).format(date);
}

// A calendar day or the day of a timestamp as "21. 9. 2026"; an unparsable value returns unchanged.
export function formatDate(value: string): string {
  const date = localDay(value) ?? new Date(value);
  return Number.isNaN(date.getTime()) ? value : dateFormat.format(date);
}

// A timestamp as its local day and time, "21. 9. 2026 14:05"; an unparsable value returns unchanged.
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : dateTimeFormat.format(date);
}

// A picked Date as the register's yyyy-mm-dd, read from its local parts and never through UTC.
export function isoDay(value: Date | undefined): string {
  if (value === undefined) {
    return '';
  }
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${String(value.getFullYear()).padStart(4, '0')}-${month}-${day}`;
}
