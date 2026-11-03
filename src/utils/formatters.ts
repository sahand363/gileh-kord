const persianIntegerFormatter = new Intl.NumberFormat('fa-IR', {
  maximumFractionDigits: 0
});

const persianDecimalFormatter = new Intl.NumberFormat('fa-IR', {
  maximumFractionDigits: 3
});

export const MAX_SAFE_AMOUNT = 999_999_999_999; // Up to ~1 trillion Toman
export const MAX_SAFE_QUANTITY = 1_000_000_000;

export function formatMoney(amount: number): string {
  if (typeof amount !== 'number' || isNaN(amount) || !Number.isFinite(amount)) {
    return '۰';
  }
  return persianIntegerFormatter.format(Math.round(amount));
}

export function formatNumber(value: number): string {
  if (typeof value !== 'number' || isNaN(value) || !Number.isFinite(value)) {
    return '۰';
  }
  return persianDecimalFormatter.format(value);
}

/**
 * Normalizes Persian (۰-۹) and Arabic (٠-٩) digits to ASCII (0-9),
 * converts Persian decimal separator (٫) to '.', and strips thousand separators.
 */
export function normalizeDigits(input: string | number | null | undefined): string {
  if (input === null || input === undefined) return '';
  return String(input)
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/٫/g, '.')
    .replace(/[٬,،\s]/g, '')
    .trim();
}

export function parseNumericInput(input: string | number | null | undefined): number {
  const normalized = normalizeDigits(input);
  if (!normalized || !/^[+-]?(\d+\.?\d*|\.\d+)$/.test(normalized)) {
    return NaN;
  }
  const num = Number(normalized);
  return Number.isFinite(num) ? num : NaN;
}

export function normalizeProductKey(name: string): string {
  return String(name ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('fa-IR');
}

/**
 * Validates that a string is a real Gregorian YYYY-MM-DD calendar date.
 */
export function isValidISODate(isoDate: string): boolean {
  if (typeof isoDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    return false;
  }
  const [yearStr, monthStr, dayStr] = isoDate.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);

  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }

  // Construct in local time at noon to avoid DST/midnight shifts
  const date = new Date(year, month - 1, day, 12, 0, 0);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

/**
 * Converts a YYYY-MM-DD ISO string into a human-readable Persian Jalali date
 * using local noon so midnight timezone offsets never shift the day.
 */
export function toJalaliDate(isoDate: string): string {
  if (!isValidISODate(isoDate)) return '';
  const [year, month, day] = isoDate.split('-').map(Number);
  const localNoon = new Date(year, month - 1, day, 12, 0, 0);
  try {
    return new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    }).format(localNoon);
  } catch {
    return isoDate;
  }
}

/**
 * Returns today's date in YYYY-MM-DD using the user's local timezone.
 */
export function getTodayISODate(referenceDate: Date = new Date()): string {
  const year = referenceDate.getFullYear();
  const month = String(referenceDate.getMonth() + 1).padStart(2, '0');
  const day = String(referenceDate.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
