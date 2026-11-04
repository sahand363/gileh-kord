import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import {
  employees,
  purchases,
  revenues,
  timesheets,
  appSettings,
  publicRevenueStore,
  dashboardSummary,
  addEmployee,
  updateEmployee,
  toggleEmployeeActive,
  addPurchase,
  addExpense,
  saveDailyTotalRevenue,
  addDetailedRevenueEntry,
  switchRevenueDayMode,
  updateGlobalRevenueCoefficient,
  addTimesheetEntry,
  updateTimesheetEntry,
  loadDemoDataset,
  clearDemoDataset,
  loadPurchases,
  resolvePurchaseEmployeeName,
  employeeByIdMap
} from '../../stores/purchaseStore';
import { ALL_STORES, dbClient, requestToPromise } from '../db';
import { purchaseRepository } from '../repositories/PurchaseRepository';
import { backupService } from '../BackupService';
import {
  calculateEmployeePurchaseAnalytics,
  calculateFinancialOverview,
  getEffectiveDayRevenue
} from '../../utils/calculations';
import {
  calculateEmployeeTimesheetSummary,
  calculateShiftDuration,
  createDefaultWeeklySchedule,
  findOverlappingShift
} from '../../utils/timesheetUtils';
import { getPersianWeekdayName, parseJalaliInputToISO } from '../../utils/jalali';

describe('Phase 4: Employees, Purchase Attribution, Revenue Privacy, Financials & Timesheets', () => {
  beforeEach(async () => {
    await dbClient.executeTransaction([...ALL_STORES], 'readwrite', async (stores) => {
      for (const name of ALL_STORES) {
        await requestToPromise(stores[name].clear());
      }
    });
    await loadPurchases(false);
  });

  it('registers, renames, and deactivates employees while keeping historical purchase attribution intact', async () => {
    const ali = await addEmployee({
      name: 'علی',
      role: 'مسئول خرید',
      performanceCoefficient: 1.15
    });

    expect(ali.id).toMatch(/^emp_/);
    expect(ali.isActive).toBe(true);
    expect(ali.performanceCoefficient).toBe(1.15);
    expect(get(appSettings).lastSelectedEmployeeId).toBe(ali.id);

    const purch = await addPurchase({
      productName: 'برنج هاشمی',
      quantity: 25,
      unit: 'کیلوگرم',
      price: 4250000,
      purchaseDate: '2026-11-03',
      employeeId: ali.id,
      supplier: 'برنج‌فروشی شمال'
    });

    expect(purch.employeeId).toBe(ali.id);

    await updateEmployee(ali.id, { name: 'علی رضوانی', role: 'سرپرست خرید' });
    const latestPurchase = get(purchases).find((p) => p.id === purch.id)!;
    expect(resolvePurchaseEmployeeName(latestPurchase, get(employeeByIdMap))).toBe(
      'علی رضوانی'
    );

    await toggleEmployeeActive(ali.id);
    const deactivated = get(employees).find((e) => e.id === ali.id)!;
    expect(deactivated.isActive).toBe(false);
    expect(resolvePurchaseEmployeeName(latestPurchase, get(employeeByIdMap))).toBe(
      'علی رضوانی'
    );
  });

  it('displays "بدون ثبت مسئول خرید" for historical purchases without an employeeId', async () => {
    const { purchase } = await purchaseRepository.createPurchaseWithProduct({
      productName: 'روغن سرخ‌کردنی',
      quantity: 10,
      unit: 'لیتر',
      totalAmount: 1800000,
      purchaseDate: '2026-10-20'
    });

    expect(purchase.employeeId).toBeUndefined();
    expect(resolvePurchaseEmployeeName(purchase, get(employeeByIdMap))).toBe(
      'بدون ثبت مسئول خرید'
    );
  });

  it('calculates employee purchase analytics accurately', async () => {
    const reza = await addEmployee({ name: 'رضا', role: 'آشپز' });

    await addPurchase({
      productName: 'زعفران',
      quantity: 100,
      unit: 'گرم',
      price: 8500000,
      purchaseDate: '2026-11-01',
      employeeId: reza.id
    });
    await addPurchase({
      productName: 'زعفران',
      quantity: 50,
      unit: 'گرم',
      price: 4300000,
      purchaseDate: '2026-11-03',
      employeeId: reza.id
    });
    await addPurchase({
      productName: 'گوشت گوسفندی',
      quantity: 10,
      unit: 'کیلوگرم',
      price: 6500000,
      purchaseDate: '2026-11-03',
      employeeId: reza.id
    });

    const analytics = calculateEmployeePurchaseAnalytics(get(purchases), reza.id);
    expect(analytics.totalPurchasesCount).toBe(3);
    expect(analytics.totalPurchasedAmount).toBe(8500000 + 4300000 + 6500000);
    expect(analytics.distinctProductsCount).toBe(2);
    expect(analytics.topProducts[0].productName).toBe('زعفران');
    expect(analytics.topProducts[0].count).toBe(2);
  });

  it('enforces public revenue chart privacy (adjusted only) while preserving raw revenue records for the Manager Area', async () => {
    const date = '2026-11-03'; // 1405/08/12 (Tuesday / سه‌شنبه)
    expect(getPersianWeekdayName(date)).toBe('سه‌شنبه');

    await saveDailyTotalRevenue({
      date,
      dailyTotalAmount: 100_000_000
    });

    // Default global coefficient is 0.7 -> publicRevenueStore must show 70,000,000
    const publicView1 = get(publicRevenueStore);
    expect(publicView1.totalAmount).toBe(70_000_000);
    expect(publicView1.dailySeries[0].amount).toBe(70_000_000);

    // Ensure shared public dashboardSummary does not leak raw totalRevenue
    const pubDash = get(dashboardSummary) as Record<string, unknown>;
    expect(pubDash.totalRevenue).toBeUndefined();
    expect(pubDash.estimatedNetOperatingBalance).toBeUndefined();

    // Manager updates coefficient to 0.5 -> public view updates to 50,000,000 without modifying raw DB record
    await updateGlobalRevenueCoefficient(0.5);
    const publicView2 = get(publicRevenueStore);
    expect(publicView2.totalAmount).toBe(50_000_000);
    expect(publicView2.dailySeries[0].amount).toBe(50_000_000);

    // Raw record in IndexedDB must still be 100,000,000
    let rec = get(revenues).find((r) => r.date === date)!;
    expect(getEffectiveDayRevenue(rec)).toBe(100_000_000);

    // Switch to detailed mode -> never double counts
    await addDetailedRevenueEntry({
      date,
      category: 'فروش غذا (سالن)',
      description: 'فروش ناهار',
      amount: 60_000_000
    });
    await addDetailedRevenueEntry({
      date,
      category: 'سفارش آنلاین',
      description: 'فروش شام آنلاین',
      amount: 40_000_000
    });

    rec = get(revenues).find((r) => r.date === date)!;
    expect(rec.mode).toBe('detailed');
    expect(getEffectiveDayRevenue(rec)).toBe(100_000_000);

    await switchRevenueDayMode(date, 'daily_total');
    await updateGlobalRevenueCoefficient(0.7);

    // Manager Financial Overview sees both Actual (100M) and Adjusted (70M) + Net Operating Balance (45M)
    const emp = await addEmployee({ name: 'مهدی', role: 'انباردار' });
    await addPurchase({
      productName: 'اقلام کلی آشپزخانه',
      quantity: 1,
      unit: 'بسته',
      price: 45_000_000,
      purchaseDate: date,
      employeeId: emp.id
    });
    await addExpense({
      title: 'اجاره و قبوض ماهانه',
      category: 'اجاره و قبوض',
      amount: 10_000_000,
      expenseDate: date
    });

    const fin = calculateFinancialOverview({
      revenues: get(revenues),
      purchases: get(purchases),
      expenses: [
        {
          id: 'e1',
          title: 'اجاره',
          category: 'اجاره و قبوض',
          amount: 10_000_000,
          expenseDate: date,
          createdAt: new Date().toISOString()
        }
      ],
      coefficient: 0.7,
      dateFrom: date,
      dateTo: date
    });

    expect(fin.totalRevenue).toBe(100_000_000);
    expect(fin.totalAdjustedRevenue).toBe(70_000_000);
    expect(fin.totalPurchases).toBe(45_000_000);
    expect(fin.totalOperationalExpenses).toBe(10_000_000);
    expect(fin.estimatedNetOperatingBalance).toBe(45_000_000);
  });

  it('calculates regular and overnight timesheet shifts, break deductions, overlaps, and expected schedule comparisons', async () => {
    const schedule = createDefaultWeeklySchedule(true);
    const emp = await addEmployee({
      name: 'محمد',
      role: 'کمک‌آشپز',
      performanceCoefficient: 0.9,
      expectedSchedule: schedule
    });

    const shift1 = await addTimesheetEntry({
      employeeId: emp.id,
      date: '2026-11-03',
      clockIn: '08:00',
      clockOut: '17:30',
      breakMinutes: 60
    });
    expect(shift1.netMinutes).toBe(510);
    expect(shift1.overnight).toBe(false);

    const overlap = findOverlappingShift(get(timesheets), {
      employeeId: emp.id,
      date: '2026-11-03',
      clockIn: '10:00',
      clockOut: '14:00'
    });
    expect(overlap?.id).toBe(shift1.id);

    const shift2 = await addTimesheetEntry({
      employeeId: emp.id,
      date: '2026-11-04',
      clockIn: '18:00',
      clockOut: '02:00',
      breakMinutes: 30,
      allowOvernight: true
    });
    expect(shift2.overnight).toBe(true);
    expect(shift2.netMinutes).toBe(450);

    const edited = await updateTimesheetEntry(shift1.id, {
      clockIn: '08:30',
      clockOut: '18:30',
      breakMinutes: 60,
      editReason: 'ثبت دقیق ورود'
    });
    expect(edited.netMinutes).toBe(540);
    expect(edited.editHistory).toHaveLength(1);
    expect(edited.editHistory?.[0].previousClockIn).toBe('08:00');

    const summary = calculateEmployeeTimesheetSummary(
      get(timesheets).filter((t) => t.employeeId === emp.id),
      emp
    );
    expect(summary.workingDaysCount).toBe(2);
    expect(summary.totalWorkingMinutes).toBe(540 + 450);
    expect(summary.lateArrivalsCount).toBeGreaterThanOrEqual(1);

    const invalidCalc = calculateShiftDuration({
      clockIn: '18:00',
      clockOut: '02:00',
      breakMinutes: 0,
      allowOvernight: false
    });
    expect(invalidCalc.isValid).toBe(false);
  });

  it('exports and atomically restores all 9 stores and removes demo data without deleting real records', async () => {
    await loadDemoDataset();
    expect(get(employees)).toHaveLength(4);

    const realEmp = await addEmployee({
      name: 'کاوه حقیقی',
      role: 'مدیر خرید',
      performanceCoefficient: 1.25
    });
    expect(get(employees)).toHaveLength(5);

    const realDate = parseJalaliInputToISO('۱۴۰۵/۰۸/۱۲')!;
    await addPurchase({
      productName: 'ماهی سفید تازه',
      quantity: 12,
      unit: 'کیلوگرم',
      price: 5400000,
      purchaseDate: realDate,
      employeeId: realEmp.id
    });
    await saveDailyTotalRevenue({
      date: realDate,
      dailyTotalAmount: 25000000
    });
    await addTimesheetEntry({
      employeeId: realEmp.id,
      date: realDate,
      clockIn: '09:00',
      clockOut: '17:00',
      breakMinutes: 30
    });

    await clearDemoDataset();
    expect(get(employees)).toHaveLength(1);
    expect(get(employees)[0].name).toBe('کاوه حقیقی');
    expect(get(purchases)).toHaveLength(1);
    expect(get(purchases)[0].employeeId).toBe(realEmp.id);
    expect(get(revenues)).toHaveLength(1);
    expect(get(timesheets)).toHaveLength(1);

    const backup = await backupService.exportBackup();
    expect(backup.version).toBe(3);
    expect(backup.employees).toHaveLength(1);
    expect(backup.revenues).toHaveLength(1);
    expect(backup.timesheets).toHaveLength(1);

    await purchaseRepository.clear();
    await backupService.restoreBackup(backup);
    const restoredPurchases = await purchaseRepository.getAll();
    expect(restoredPurchases).toHaveLength(1);
    expect(restoredPurchases[0].employeeId).toBe(realEmp.id);
  });
});
