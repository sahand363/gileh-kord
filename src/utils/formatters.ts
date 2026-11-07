import {
  formatJalaliDateTime,
  formatJalaliLong,
  formatJalaliNumeric,
  isValidGregorianISODate
} from './jalali';
import type { ReportingCurrency } from '../models/types';

const persianIntegerFormatter = new Intl.NumberFormat('fa-IR', {
  maximumFractionDigits: 0
});

const persianDecimalFormatter = new Intl.NumberFormat('fa-IR', {
  maximumFractionDigits: 3
});

export const MAX_SAFE_AMOUNT = 999_999_999_999;
export const MAX_SAFE_QUANTITY = 1_000_000_000;
export const RIAL_PER_TOMAN = 10;

export function formatMoney(amount: number): string {
  if (typeof amount !== 'number' || isNaN(amount) || !Number.isFinite(amount)) {
    return '۰';
  }
  return persianIntegerFormatter.format(Math.round(amount));
}

/**
 * Formats a canonical Toman integer in either TOMAN or RIAL (1 Toman = 10 Rial)
 * for display/reporting only, without modifying stored data.
 */
export function formatReportingMoney(
  tomanAmount: number,
  reportingCurrency: ReportingCurrency = 'TOMAN'
): string {
  if (typeof tomanAmount !== 'number' || isNaN(tomanAmount) || !Number.isFinite(tomanAmount)) {
    return '۰';
  }
  const value =
    reportingCurrency === 'RIAL'
      ? Math.round(tomanAmount) * RIAL_PER_TOMAN
      : Math.round(tomanAmount);
  return persianIntegerFormatter.format(value);
}

export function getCurrencyLabel(reportingCurrency: ReportingCurrency = 'TOMAN'): string {
  return reportingCurrency === 'RIAL' ? 'ریال' : 'تومان';
}

export function formatNumber(value: number): string {
  if (typeof value !== 'number' || isNaN(value) || !Number.isFinite(value)) {
    return '۰';
  }
  return persianDecimalFormatter.format(value);
}

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

export function isValidISODate(isoDate: string): boolean {
  return isValidGregorianISODate(isoDate);
}

export function toJalaliDate(isoDate: string): string {
  return formatJalaliLong(isoDate);
}

export function toJalaliNumeric(isoDate: string): string {
  return formatJalaliNumeric(isoDate);
}

export function toJalaliDateTime(isoTimestamp: string): string {
  return formatJalaliDateTime(isoTimestamp);
}

export function getTodayISODate(referenceDate: Date = new Date()): string {
  const year = referenceDate.getFullYear();
  const month = String(referenceDate.getMonth() + 1).padStart(2, '0');
  const day = String(referenceDate.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
