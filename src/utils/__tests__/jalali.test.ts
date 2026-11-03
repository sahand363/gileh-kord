import { describe, it, expect } from 'vitest';
import {
  formatJalaliLong,
  formatJalaliNumeric,
  getJalaliMonthLength,
  getJalaliMonthMatrix,
  isJalaliLeapYear,
  isoToJalaliParts,
  jalaliPartsToISO,
  parseJalaliInputToISO
} from '../jalali';

describe('Persian Jalali Calendar Utilities', () => {
  it('accurately converts ISO dates to Jalali parts and back across year boundaries', () => {
    // 2026-11-03 -> 12 Aban 1405 (1405/08/12)
    const parts = isoToJalaliParts('2026-11-03');
    expect(parts).toEqual({ jy: 1405, jm: 8, jd: 12 });
    expect(formatJalaliNumeric('2026-11-03')).toBe('۱۴۰۵/۰۸/۱۲');
    expect(formatJalaliLong('2026-11-03')).toBe('۱۲ آبان ۱۴۰۵');

    // Nowruz boundary: 1405/01/01 -> 2026-03-21
    const nowruzIso = jalaliPartsToISO(1405, 1, 1);
    expect(nowruzIso).toBe('2026-03-21');
    expect(isoToJalaliParts('2026-03-21')).toEqual({ jy: 1405, jm: 1, jd: 1 });
  });

  it('handles Jalali leap years and month day lengths (31, 30, 29)', () => {
    // 1403 is a leap year in the Jalali calendar (Esfand has 30 days)
    expect(isJalaliLeapYear(1403)).toBe(true);
    expect(getJalaliMonthLength(1403, 12)).toBe(30);
    expect(jalaliPartsToISO(1403, 12, 30)).toBe('2025-03-20');

    // 1404 and 1405 are non-leap years (Esfand has 29 days)
    expect(isJalaliLeapYear(1404)).toBe(false);
    expect(getJalaliMonthLength(1404, 12)).toBe(29);
    expect(jalaliPartsToISO(1404, 12, 30)).toBeNull();

    // First 6 months have 31 days; months 7-11 have 30 days
    for (let m = 1; m <= 6; m++) {
      expect(getJalaliMonthLength(1405, m)).toBe(31);
    }
    for (let m = 7; m <= 11; m++) {
      expect(getJalaliMonthLength(1405, m)).toBe(30);
    }
  });

  it('parses Persian and English Jalali date strings into ISO YYYY-MM-DD', () => {
    expect(parseJalaliInputToISO('۱۴۰۵/۰۸/۱۲')).toBe('2026-11-03');
    expect(parseJalaliInputToISO('1405-8-12')).toBe('2026-11-03');
    expect(parseJalaliInputToISO('۱۴۰۴/۱۲/۳۰')).toBeNull(); // Invalid non-leap Esfand 30
  });

  it('builds a valid calendar grid matrix for any Jalali month', () => {
    const cells = getJalaliMonthMatrix(1405, 8);
    const dayCells = cells.filter((c) => c !== null);
    expect(dayCells).toHaveLength(30);
    expect(dayCells[0]?.isoDate).toBe(jalaliPartsToISO(1405, 8, 1));
    expect(dayCells[29]?.isoDate).toBe(jalaliPartsToISO(1405, 8, 30));
  });
});
