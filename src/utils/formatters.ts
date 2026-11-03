const persianNumberFormatter = new Intl.NumberFormat('fa-IR');

export function formatMoney(amount: number): string {
  if (isNaN(amount) || !Number.isFinite(amount)) return '۰';
  return persianNumberFormatter.format(Math.round(amount));
}

export function formatNumber(value: number): string {
  if (isNaN(value) || !Number.isFinite(value)) return '۰';
  return persianNumberFormatter.format(value);
}

export function normalizeDigits(input: string | number): string {
  return String(input ?? '')
    .replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d).toString())
    .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d).toString())
    .replace(/[٬,،\s]/g, '')
    .trim();
}

export function parseNumericInput(input: string | number): number {
  const normalized = normalizeDigits(input);
  if (!normalized) return NaN;
  const num = Number(normalized);
  return Number.isFinite(num) ? num : NaN;
}

export function toJalaliDate(isoDate: string): string {
  if (!isoDate) return '';
  try {
    const date = new Date(`${isoDate}T12:00:00`);
    return new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    }).format(date);
  } catch {
    return isoDate;
  }
}

export function getTodayISODate(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
