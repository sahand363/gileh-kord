import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import {
  employees,
  purchases,
  revenues,
  timesheets,
  inventory,
  publicRevenueStore,
  addEmployee,
  updateEmployee,
  addPurchase,
  updatePurchase,
  addInventoryItem,
  toggleInventoryAlert,
  saveDailyTotalRevenue,
  updateGlobalRevenueCoefficient,
  addTimesheetEntry,
  loadDemoDataset,
  clearDemoDataset,
  loadPurchases
} from '../../stores/purchaseStore';
import { ALL_STORES, dbClient, requestToPromise } from '../db';
import {
  calculateStaffRevenueAllocations,
  getLowStockItems
} from '../../utils/calculations';

describe('Phase 4 Updated Requirements: Editable Purchases, Optional Stock Alerts & Staff Multipliers', () => {
  beforeEach(async () => {
    await dbClient.executeTransaction([...ALL_STORES], 'readwrite', async (stores) => {
      for (const name of ALL_STORES) {
        await requestToPromise(stores[name].clear());
      }
    });
    await loadPurchases(false);
  });

  it('allows editing a registered purchase and persists changes in IndexedDB', async () => {
    const ali = await addEmployee({ name: 'علی', role: 'مسئول خرید' });
    const reza = await addEmployee({ name: 'رضا', role: 'آشپز' });

    const created = await addPurchase({
      productName: 'برنج هاشمی',
      quantity: 20,
      unit: 'کیلوگرم',
      price: 3400000,
      purchaseDate: '2026-11-03',
      employeeId: ali.id,
      supplier: 'برنج‌فروشی شمال'
    });

    const edited = await updatePurchase(created.id, {
      productName: 'برنج هاشمی ممتاز',
      quantity: 25,
      unit: 'کیلوگرم',
      price: 4250000,
      purchaseDate: '2026-11-04',
      employeeId: reza.id,
      supplier: 'پخش گیلان',
      invoice: '۲۰۴۸',
      notes: 'ویرایش شده'
    });

    expect(edited.productName).toBe('برنج هاشمی ممتاز');
    expect(edited.quantity).toBe(25);
    expect(edited.totalAmount).toBe(4250000);
    expect(edited.employeeId).toBe(reza.id);
    expect(get(purchases)[0].productName).toBe('برنج هاشمی ممتاز');
  });

  it('triggers stock shortage alerts only when alertEnabled is checked for that product', async () => {
    await addInventoryItem({
      productName: 'روغن سرخ‌کردنی',
      category: 'روغن',
      currentStock: 3,
      minStockThreshold: 10,
      unit: 'لیتر',
      alertEnabled: false
    });

    // Not checked yet -> 0 alerts
    expect(getLowStockItems(get(inventory))).toHaveLength(0);

    // Check the box for this product -> alert becomes active
    const item = get(inventory)[0];
    await toggleInventoryAlert(item.id, true);
    expect(getLowStockItems(get(inventory))).toHaveLength(1);
    expect(getLowStockItems(get(inventory))[0].productName).toBe('روغن سرخ‌کردنی');
  });

  it('allocates revenue proportionally using individual staff multipliers (10h * 0.6 = 6h) and multiplies frontend revenue by 0.6', async () => {
    const staffA = await addEmployee({
      name: 'علی',
      role: 'خرید',
      performanceCoefficient: 0.6
    });
    const staffB = await addEmployee({
      name: 'رضا',
      role: 'آشپز',
      performanceCoefficient: 0.6
    });

    // Staff A works 10 hours (08:00 to 18:00, 0 break) -> 10 * 0.6 = 6 effective hours
    await addTimesheetEntry({
      employeeId: staffA.id,
      date: '2026-11-03',
      clockIn: '08:00',
      clockOut: '18:00',
      breakMinutes: 0
    });

    // Staff B works 10 hours (08:00 to 18:00, 0 break) -> 10 * 0.6 = 6 effective hours
    await addTimesheetEntry({
      employeeId: staffB.id,
      date: '2026-11-03',
      clockIn: '08:00',
      clockOut: '18:00',
      breakMinutes: 0
    });

    await saveDailyTotalRevenue({
      date: '2026-11-03',
      dailyTotalAmount: 10_000_000
    });

    const alloc = calculateStaffRevenueAllocations({
      employees: get(employees),
      timesheets: get(timesheets),
      totalRevenue: 10_000_000
    });

    expect(alloc.rows[0].rawHours).toBe(10);
    expect(alloc.rows[0].effectiveHours).toBe(6);
    expect(alloc.totalEffectiveHours).toBe(12);
    expect(alloc.rows[0].allocatedRevenue).toBe(5_000_000);
    expect(alloc.rows[1].allocatedRevenue).toBe(5_000_000);

    // Manager frontend revenue multiplied by 0.6 -> 6,000,000
    await updateGlobalRevenueCoefficient(0.6);
    const pubRev = get(publicRevenueStore);
    expect(pubRev.totalAmount).toBe(6_000_000);
    expect(pubRev.recentDates[0].date).toBe('2026-11-03');
  });

  it('removes demo data cleanly without deleting real records', async () => {
    await loadDemoDataset();
    const emp = await addEmployee({
      name: 'کاوه',
      role: 'مدیر',
      performanceCoefficient: 0.8
    });
    await clearDemoDataset();
    expect(get(employees)).toHaveLength(1);
    expect(get(employees)[0].id).toBe(emp.id);
    expect(get(revenues)).toHaveLength(0);
  });
});
