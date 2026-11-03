import type {
  Employee,
  PersianWeekdayIndex,
  TimesheetEntry,
  WeeklyExpectedSchedule
} from '../models/types';
import { getPersianWeekdayIndex, toPersianDigits } from './jalali';
import { normalizeDigits } from './formatters';

export function createDefaultWeeklySchedule(
  enabledByDefault = false
): WeeklyExpectedSchedule {
  const schedule: Partial<WeeklyExpectedSchedule> = {};
  for (let i = 0; i <= 6; i++) {
    schedule[i as PersianWeekdayIndex] = {
      enabled: enabledByDefault && i < 6, // Saturday..Thursday
      startTime: '08:00',
      endTime: '17:00'
    };
  }
  return schedule as WeeklyExpectedSchedule;
}

/**
 * Parses a "HH:MM" string (supporting Persian or English digits) into minutes since 00:00 (0..1439).
 */
export function parseTimeToMinutes(timeStr: string): number | null {
  if (!timeStr || typeof timeStr !== 'string') return null;
  const clean = normalizeDigits(timeStr);
  const match = clean.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }
  return hours * 60 + minutes;
}

export function normalizeTimeString(timeStr: string): string | null {
  const mins = parseTimeToMinutes(timeStr);
  if (mins === null) return null;
  const hh = String(Math.floor(mins / 60)).padStart(2, '0');
  const mm = String(mins % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

export interface ShiftCalculationResult {
  isValid: boolean;
  error?: string;
  overnight: boolean;
  grossMinutes: number;
  netMinutes: number;
  normalizedClockIn: string;
  normalizedClockOut: string;
}

/**
 * Calculates shift duration from clockIn and clockOut.
 * - If `allowOvernight` is true and `clockOut < clockIn`, treats `clockOut` as next day (+24h).
 * - If `allowOvernight` is false and `clockOut <= clockIn`, returns an error.
 * - Deducts `breakMinutes` and ensures `netMinutes > 0`.
 */
export function calculateShiftDuration(params: {
  clockIn: string;
  clockOut: string;
  breakMinutes: number;
  allowOvernight?: boolean;
}): ShiftCalculationResult {
  const inMins = parseTimeToMinutes(params.clockIn);
  if (inMins === null) {
    return {
      isValid: false,
      error: 'ساعت ورود معتبر نیست (فرمت صحیح: 08:00).',
      overnight: false,
      grossMinutes: 0,
      netMinutes: 0,
      normalizedClockIn: '',
      normalizedClockOut: ''
    };
  }

  const outMins = parseTimeToMinutes(params.clockOut);
  if (outMins === null) {
    return {
      isValid: false,
      error: 'ساعت خروج نمی‌تواند بدون ساعت ورود یا با فرمت نامعتبر ثبت شود.',
      overnight: false,
      grossMinutes: 0,
      netMinutes: 0,
      normalizedClockIn: '',
      normalizedClockOut: ''
    };
  }

  const breakMins = Math.max(0, Math.round(Number(params.breakMinutes) || 0));
  let overnight = false;
  let grossMinutes = outMins - inMins;

  if (grossMinutes === 0) {
    return {
      isValid: false,
      error: 'ساعت ورود و خروج نمی‌تواند یکسان باشد.',
      overnight: false,
      grossMinutes: 0,
      netMinutes: 0,
      normalizedClockIn: '',
      normalizedClockOut: ''
    };
  }

  if (grossMinutes < 0) {
    if (params.allowOvernight !== false) {
      overnight = true;
      grossMinutes = 1440 - inMins + outMins;
    } else {
      return {
        isValid: false,
        error: 'ساعت خروج از ساعت ورود کوچکتر است (برای شیفت شبانه گزینه شیفت عبوری از نیمه‌شب را فعال کنید).',
        overnight: false,
        grossMinutes: 0,
        netMinutes: 0,
        normalizedClockIn: '',
        normalizedClockOut: ''
      };
    }
  }

  if (breakMins >= grossMinutes) {
    return {
      isValid: false,
      error: 'مدت استراحت نمی‌تواند بیشتر یا مساوی کل زمان حضور باشد.',
      overnight,
      grossMinutes,
      netMinutes: 0,
      normalizedClockIn: '',
      normalizedClockOut: ''
    };
  }

  const netMinutes = grossMinutes - breakMins;
  return {
    isValid: true,
    overnight,
    grossMinutes,
    netMinutes,
    normalizedClockIn: normalizeTimeString(params.clockIn)!,
    normalizedClockOut: normalizeTimeString(params.clockOut)!
  };
}

/**
 * Checks whether a candidate shift overlaps with any existing shift for the same employee on the same date.
 */
export function findOverlappingShift(
  existingShifts: TimesheetEntry[],
  candidate: {
    employeeId: string;
    date: string;
    clockIn: string;
    clockOut: string;
    excludeShiftId?: string;
  }
): TimesheetEntry | null {
  const startA = parseTimeToMinutes(candidate.clockIn);
  const rawEndA = parseTimeToMinutes(candidate.clockOut);
  if (startA === null || rawEndA === null) return null;
  const endA = rawEndA < startA ? rawEndA + 1440 : rawEndA;

  for (const shift of existingShifts) {
    if (shift.employeeId !== candidate.employeeId) continue;
    if (shift.date !== candidate.date) continue;
    if (candidate.excludeShiftId && shift.id === candidate.excludeShiftId) continue;

    const startB = parseTimeToMinutes(shift.clockIn);
    const rawEndB = parseTimeToMinutes(shift.clockOut);
    if (startB === null || rawEndB === null) continue;
    const endB = rawEndB < startB ? rawEndB + 1440 : rawEndB;

    if (startA < endB && endA > startB) {
      return shift;
    }
  }

  return null;
}

export function formatMinutesToPersianHours(totalMinutes: number): string {
  const safe = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(safe / 60);
  const mins = safe % 60;
  if (hours === 0) {
    return `${toPersianDigits(mins)} دقیقه`;
  }
  if (mins === 0) {
    return `${toPersianDigits(hours)} ساعت`;
  }
  return `${toPersianDigits(hours)} ساعت و ${toPersianDigits(mins)} دقیقه`;
}

export interface ShiftScheduleComparison {
  hasExpectedSchedule: boolean;
  expectedMinutes: number;
  actualNetMinutes: number;
  lateArrivalMinutes: number;
  earlyDepartureMinutes: number;
  overtimeMinutes: number;
}

export function compareShiftWithExpectedSchedule(
  entry: TimesheetEntry,
  employee?: Employee | null
): ShiftScheduleComparison {
  const weekdayIdx = getPersianWeekdayIndex(entry.date);
  const dayRule =
    weekdayIdx !== null && employee?.expectedSchedule
      ? employee.expectedSchedule[weekdayIdx]
      : undefined;

  if (!dayRule || !dayRule.enabled) {
    return {
      hasExpectedSchedule: false,
      expectedMinutes: 0,
      actualNetMinutes: entry.netMinutes,
      lateArrivalMinutes: 0,
      earlyDepartureMinutes: 0,
      overtimeMinutes: 0
    };
  }

  const expStart = parseTimeToMinutes(dayRule.startTime);
  const rawExpEnd = parseTimeToMinutes(dayRule.endTime);
  const actStart = parseTimeToMinutes(entry.clockIn);
  const rawActEnd = parseTimeToMinutes(entry.clockOut);

  if (
    expStart === null ||
    rawExpEnd === null ||
    actStart === null ||
    rawActEnd === null
  ) {
    return {
      hasExpectedSchedule: false,
      expectedMinutes: 0,
      actualNetMinutes: entry.netMinutes,
      lateArrivalMinutes: 0,
      earlyDepartureMinutes: 0,
      overtimeMinutes: 0
    };
  }

  const expEnd = rawExpEnd < expStart ? rawExpEnd + 1440 : rawExpEnd;
  const actEnd = rawActEnd < actStart ? rawActEnd + 1440 : rawActEnd;

  const expectedMinutes = Math.max(0, expEnd - expStart);
  const lateArrivalMinutes = Math.max(0, actStart - expStart);
  const earlyDepartureMinutes = Math.max(0, expEnd - actEnd);
  const overtimeMinutes = Math.max(0, entry.netMinutes - expectedMinutes);

  return {
    hasExpectedSchedule: true,
    expectedMinutes,
    actualNetMinutes: entry.netMinutes,
    lateArrivalMinutes,
    earlyDepartureMinutes,
    overtimeMinutes
  };
}

export interface EmployeeTimesheetSummary {
  totalWorkingMinutes: number;
  totalWorkingHoursDecimal: number;
  workingDaysCount: number;
  shiftsCount: number;
  averageDailyMinutes: number;
  expectedTotalMinutes: number;
  lateArrivalsCount: number;
  totalLateMinutes: number;
  earlyDeparturesCount: number;
  totalEarlyMinutes: number;
  totalOvertimeMinutes: number;
}

export function calculateEmployeeTimesheetSummary(
  entries: TimesheetEntry[],
  employee?: Employee | null
): EmployeeTimesheetSummary {
  const uniqueDates = new Set<string>();
  let totalWorkingMinutes = 0;
  let expectedTotalMinutes = 0;
  let lateArrivalsCount = 0;
  let totalLateMinutes = 0;
  let earlyDeparturesCount = 0;
  let totalEarlyMinutes = 0;
  let totalOvertimeMinutes = 0;

  for (const entry of entries) {
    uniqueDates.add(entry.date);
    totalWorkingMinutes += entry.netMinutes;

    const cmp = compareShiftWithExpectedSchedule(entry, employee);
    if (cmp.hasExpectedSchedule) {
      expectedTotalMinutes += cmp.expectedMinutes;
      if (cmp.lateArrivalMinutes > 0) {
        lateArrivalsCount += 1;
        totalLateMinutes += cmp.lateArrivalMinutes;
      }
      if (cmp.earlyDepartureMinutes > 0) {
        earlyDeparturesCount += 1;
        totalEarlyMinutes += cmp.earlyDepartureMinutes;
      }
      totalOvertimeMinutes += cmp.overtimeMinutes;
    }
  }

  const workingDaysCount = uniqueDates.size;
  const averageDailyMinutes =
    workingDaysCount > 0 ? Math.round(totalWorkingMinutes / workingDaysCount) : 0;

  return {
    totalWorkingMinutes,
    totalWorkingHoursDecimal: Number((totalWorkingMinutes / 60).toFixed(2)),
    workingDaysCount,
    shiftsCount: entries.length,
    averageDailyMinutes,
    expectedTotalMinutes,
    lateArrivalsCount,
    totalLateMinutes,
    earlyDeparturesCount,
    totalEarlyMinutes,
    totalOvertimeMinutes
  };
}
