import { describe, it, expect } from 'vitest';
import {
  formatMoney,
  formatNumber,
  getTodayISODate,
  isValidISODate,
  normalizeDigits,
  parseNumericInput,
  toJalaliDate
} from '../formatters';

describe('formatters & numeric normalization', () => {
  it('normalizes Persian, Arabic, and ASCII digits with thousand and decimal separators', () => {
    expect(normalizeDigits('۲٬۵۰۰٬۰۰۰')).toBe('2500000');
    expect(normalizeDigits('١٢,٣٤٥')).toBe('12345');
    expect(normalizeDigits('۲٫۵')).toBe('2.5');
    expect(normalizeDigits(' ۰.۷۵ ')).toBe('0.75');
  });

  it('parses valid integer and decimal numeric inputs and rejects malformed strings', () => {
    expect(parseNumericInput('۲۵')).toBe(25);
    expect(parseNumericInput('۱۲٫۵')).toBe(12.5);
    expect(parseNumericInput('4,250,000')).toBe(4250000);
    expect(parseNumericInput('')).toBeNaN();
    expect(parseNumericInput('۱۲..۵')).toBeNaN();
    expect(parseNumericInput('abc')).toBeNaN();
  });

  it('formats Toman currency and decimal quantities in Persian locale', () => {
    expect(formatMoney(0)).toBe('۰');
    expect(formatMoney(4250000)).toBe('۴٬۲۵۰٬۰۰۰');
    expect(formatMoney(1250000000)).toBe('۱٬۲۵۰٬۰۰۰٬۰۰۰');
    expect(formatMoney(NaN)).toBe('۰');
    expect(formatNumber(2.5)).toBe('۲٫۵');
  });

  it('validates ISO dates strictly and avoids midnight timezone shifts', () => {
    expect(isValidISODate('2026-11-03')).toBe(true);
    expect(isValidISODate('2026-02-29')).toBe(false);
    expect(isValidISODate('2026-13-01')).toBe(false);
    expect(isValidISODate('not-a-date')).toBe(false);

    const lateNightLocal = new Date(2026, 10, 3, 23, 59, 59);
    const earlyMorningLocal = new Date(2026, 10, 3, 0, 0, 1);
    expect(getTodayISODate(lateNightLocal)).toBe('2026-11-03');
    expect(getTodayISODate(earlyMorningLocal)).toBe('2026-11-03');

    const jalali = toJalaliDate('2026-11-03');
    expect(jalali).toContain('۱۴۰۵');
    expect(toJalaliDate('invalid')).toBe('');
  });
});
