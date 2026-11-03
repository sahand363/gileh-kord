import jalaali from 'jalaali-js';
import type { JalaaliDateObject } from 'jalaali-js';
import { PERSIAN_WEEKDAYS, type PersianWeekdayIndex } from '../models/types';

export const JALALI_MONTH_NAMES = [
  'فروردین',
  'اردیبهشت',
  'خرداد',
  'تیر',
  'مرداد',
  'شهریور',
  'مهر',
  'آبان',
  'آذر',
  'دی',
  'بهمن',
  'اسفند'
] as const;

export const JALALI_WEEKDAYS_SHORT = [
  'ش',
  'ی',
  'د',
  'س',
  'چ',
  'پ',
  'ج'
] as const;

const faDigitFormatter = new Intl.NumberFormat('fa-IR', {
  useGrouping: false
});

export function toPersianDigits(value: string | number): string {
  return String(value).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
}

export function padPersianTwo(num: number): string {
  return toPersianDigits(String(num).padStart(2, '0'));
}

export function isValidGregorianISODate(isoDate: string): boolean {
  if (typeof isoDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    return false;
  }
  const [y, m, d] = isoDate.split('-').map(Number);
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) {
    return false;
  }
  const dt = new Date(y, m - 1, d, 12, 0, 0);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

export function isoToJalaliParts(isoDate: string): JalaaliDateObject | null {
  if (!isValidGregorianISODate(isoDate)) return null;
  const [gy, gm, gd] = isoDate.split('-').map(Number);
  return jalaali.toJalaali(gy, gm, gd);
}

export function jalaliPartsToISO(jy: number, jm: number, jd: number): string | null {
  if (!jalaali.isValidJalaaliDate(jy, jm, jd)) {
    return null;
  }
  const { gy, gm, gd } = jalaali.toGregorian(jy, jm, jd);
  return `${String(gy).padStart(4, '0')}-${String(gm).padStart(2, '0')}-${String(gd).padStart(2, '0')}`;
}

export function isJalaliLeapYear(jy: number): boolean {
  return jalaali.isLeapJalaaliYear(jy);
}

export function getJalaliMonthLength(jy: number, jm: number): number {
  if (jm < 1 || jm > 12) return 30;
  return jalaali.jalaaliMonthLength(jy, jm);
}

/**
 * Returns the Persian weekday index (0 = شنبه / Saturday ... 6 = جمعه / Friday)
 * from a YYYY-MM-DD Gregorian ISO date at local noon (immune to DST/midnight drift).
 */
export function getPersianWeekdayIndex(isoDate: string): PersianWeekdayIndex | null {
  if (!isValidGregorianISODate(isoDate)) return null;
  const [gy, gm, gd] = isoDate.split('-').map(Number);
  const dt = new Date(gy, gm - 1, gd, 12, 0, 0);
  return ((dt.getDay() + 1) % 7) as PersianWeekdayIndex;
}

/**
 * Returns the full Persian weekday name (e.g. 'سه‌شنبه') for a YYYY-MM-DD ISO date.
 */
export function getPersianWeekdayName(isoDate: string): string {
  const idx = getPersianWeekdayIndex(isoDate);
  if (idx === null) return '';
  return PERSIAN_WEEKDAYS[idx];
}

export function formatJalaliLong(isoDate: string): string {
  const parts = isoToJalaliParts(isoDate);
  if (!parts) return '';
  const monthName = JALALI_MONTH_NAMES[parts.jm - 1] || '';
  return `${faDigitFormatter.format(parts.jd)} ${monthName} ${faDigitFormatter.format(parts.jy)}`;
}

export function formatJalaliNumeric(isoDate: string): string {
  const parts = isoToJalaliParts(isoDate);
  if (!parts) return '';
  return `${toPersianDigits(parts.jy)}/${padPersianTwo(parts.jm)}/${padPersianTwo(parts.jd)}`;
}

export function formatJalaliWithWeekday(isoDate: string): string {
  const num = formatJalaliNumeric(isoDate);
  const wd = getPersianWeekdayName(isoDate);
  if (!num) return '';
  return wd ? `${wd} ${num}` : num;
}

export function getJalaliYearMonthKey(isoDate: string): string {
  const parts = isoToJalaliParts(isoDate);
  if (!parts) return '';
  return `${parts.jy}/${String(parts.jm).padStart(2, '0')}`;
}

export function formatJalaliYearMonthLabel(ymKey: string): string {
  const [jyStr, jmStr] = ymKey.split('/');
  const jy = Number(jyStr);
  const jm = Number(jmStr);
  if (!jy || jm < 1 || jm > 12) return ymKey;
  return `${JALALI_MONTH_NAMES[jm - 1]} ${toPersianDigits(jy)}`;
}

export function formatJalaliDateTime(isoTimestamp: string): string {
  if (!isoTimestamp) return '';
  const d = new Date(isoTimestamp);
  if (isNaN(d.getTime())) return '';
  const gy = d.getFullYear();
  const gm = d.getMonth() + 1;
  const gd = d.getDate();
  const { jy, jm, jd } = jalaali.toJalaali(gy, gm, gd);
  const hh = padPersianTwo(d.getHours());
  const mm = padPersianTwo(d.getMinutes());
  return `${toPersianDigits(jd)} ${JALALI_MONTH_NAMES[jm - 1]} ${toPersianDigits(jy)} — ساعت ${hh}:${mm}`;
}

export function parseJalaliInputToISO(input: string): string | null {
  if (!input) return null;
  const ascii = String(input)
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .trim();

  const match = ascii.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (!match) return null;

  const jy = Number(match[1]);
  const jm = Number(match[2]);
  const jd = Number(match[3]);

  return jalaliPartsToISO(jy, jm, jd);
}

export interface JalaliCalendarCell {
  jd: number;
  isoDate: string;
  isCurrentMonth: boolean;
}

export function getJalaliMonthStartWeekday(jy: number, jm: number): number {
  const { gy, gm, gd } = jalaali.toGregorian(jy, jm, 1);
  const dt = new Date(gy, gm - 1, gd, 12, 0, 0);
  return (dt.getDay() + 1) % 7;
}

export function getJalaliMonthMatrix(
  jy: number,
  jm: number
): Array<JalaliCalendarCell | null> {
  const daysInMonth = getJalaliMonthLength(jy, jm);
  const startOffset = getJalaliMonthStartWeekday(jy, jm);
  const cells: Array<JalaliCalendarCell | null> = [];

  for (let i = 0; i < startOffset; i++) {
    cells.push(null);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const iso = jalaliPartsToISO(jy, jm, day);
    if (iso) {
      cells.push({
        jd: day,
        isoDate: iso,
        isCurrentMonth: true
      });
    }
  }

  return cells;
}
