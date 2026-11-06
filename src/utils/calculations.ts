import type {
  Employee,
  Expense,
  InventoryItem,
  Purchase,
  PurchaseFilterCriteria,
  PurchaseSummaryStats,
  RevenueDayRecord,
  TimesheetEntry
} from '../models/types';
import { getTodayISODate } from './formatters';
import { getJalaliYearMonthKey } from './jalali';

export function sortPurchasesDescending(items: Purchase[]): Purchase[] {
  return [...items].sort(
    (a, b) =>
      b.purchaseDate.localeCompare(a.purchaseDate) ||
      b.createdAt.localeCompare(a.createdAt) ||
      b.id.localeCompare(a.id)
  );
}

export function filterPurchases(
  items: Purchase[],
  criteria: PurchaseFilterCriteria
): Purchase[] {
  const query = criteria.query?.trim().toLocaleLowerCase('fa-IR') || '';
  const dateFrom = criteria.dateFrom?.trim() || '';
  const dateTo = criteria.dateTo?.trim() || '';
  const supplier = criteria.supplierName?.trim().toLocaleLowerCase('fa-IR') || '';
  const empFilter = criteria.employeeId?.trim() || '';

  return sortPurchasesDescending(items).filter((item) => {
    if (criteria.onlyReal && item.isDemo) return false;

    if (empFilter === '__unassigned__') {
      if (item.employeeId) return false;
    } else if (empFilter) {
      if (item.employeeId !== empFilter) return false;
    }

    const matchesQuery =
      !query ||
      item.productName.toLocaleLowerCase('fa-IR').includes(query) ||
      (item.supplierName &&
        item.supplierName.toLocaleLowerCase('fa-IR').includes(query)) ||
      (item.invoiceNumber &&
        item.invoiceNumber.toLocaleLowerCase('fa-IR').includes(query));
    const matchesSupplier =
      !supplier ||
      (item.supplierName &&
        item.supplierName.toLocaleLowerCase('fa-IR').includes(supplier));
    const matchesFrom = !dateFrom || item.purchaseDate >= dateFrom;
    const matchesTo = !dateTo || item.purchaseDate <= dateTo;
    return matchesQuery && matchesSupplier && matchesFrom && matchesTo;
  });
}

export function calculatePurchaseStats(items: Purchase[]): PurchaseSummaryStats {
  const count = items.length;
  const total = items.reduce((sum, item) => sum + (Number(item.totalAmount) || 0), 0);
  const average = count > 0 ? Math.round(total / count) : 0;
  return { count, total, average };
}

/**
 * Only returns items where the user has explicitly checked `alertEnabled`
 * and currentStock <= minStockThreshold.
 */
export function getLowStockItems(inventory: InventoryItem[]): InventoryItem[] {
  return inventory.filter(
    (item) => Boolean(item.alertEnabled) && item.currentStock <= item.minStockThreshold
  );
}

export function calculateExpensesTotal(expenses: Expense[]): number {
  return expenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
}

export function getTopPurchasedProducts(
  purchases: Purchase[],
  limit: number = 5
): Array<{ productName: string; totalAmount: number; count: number; unit: string }> {
  const map = new Map<
    string,
    { productName: string; totalAmount: number; count: number; unit: string }
  >();

  for (const p of purchases) {
    const key = p.productName.trim();
    const existing = map.get(key);
    if (existing) {
      existing.totalAmount += p.totalAmount;
      existing.count += 1;
    } else {
      map.set(key, {
        productName: key,
        totalAmount: p.totalAmount,
        count: 1,
        unit: p.unit
      });
    }
  }

  return Array.from(map.values())
    .sort((a, b) => b.totalAmount - a.totalAmount || b.count - a.count)
    .slice(0, limit);
}

export interface EmployeePurchaseAnalytics {
  employeeId: string;
  totalPurchasesCount: number;
  totalPurchasedAmount: number;
  averagePurchaseAmount: number;
  distinctProductsCount: number;
  mostRecentPurchase: Purchase | null;
  topProducts: Array<{
    productName: string;
    count: number;
    totalAmount: number;
    unit: string;
  }>;
  monthlyActivity: Array<{
    jalaliMonthKey: string;
    count: number;
    totalAmount: number;
  }>;
  purchases: Purchase[];
}

export function calculateEmployeePurchaseAnalytics(
  allPurchases: Purchase[],
  employeeId: string,
  dateFrom?: string,
  dateTo?: string
): EmployeePurchaseAnalytics {
  const filtered = filterPurchases(allPurchases, {
    employeeId,
    dateFrom,
    dateTo
  });

  const stats = calculatePurchaseStats(filtered);
  const productMap = new Map<
    string,
    { productName: string; count: number; totalAmount: number; unit: string }
  >();
  const monthMap = new Map<string, { count: number; totalAmount: number }>();

  for (const p of filtered) {
    const prodKey = p.productName.trim();
    const prevProd = productMap.get(prodKey);
    if (prevProd) {
      prevProd.count += 1;
      prevProd.totalAmount += p.totalAmount;
    } else {
      productMap.set(prodKey, {
        productName: prodKey,
        count: 1,
        totalAmount: p.totalAmount,
        unit: p.unit
      });
    }

    const ym = getJalaliYearMonthKey(p.purchaseDate);
    if (ym) {
      const prevMonth = monthMap.get(ym) || { count: 0, totalAmount: 0 };
      prevMonth.count += 1;
      prevMonth.totalAmount += p.totalAmount;
      monthMap.set(ym, prevMonth);
    }
  }

  const topProducts = Array.from(productMap.values())
    .sort((a, b) => b.count - a.count || b.totalAmount - a.totalAmount)
    .slice(0, 5);

  const monthlyActivity = Array.from(monthMap.entries())
    .map(([jalaliMonthKey, data]) => ({
      jalaliMonthKey,
      count: data.count,
      totalAmount: data.totalAmount
    }))
    .sort((a, b) => b.jalaliMonthKey.localeCompare(a.jalaliMonthKey));

  return {
    employeeId,
    totalPurchasesCount: stats.count,
    totalPurchasedAmount: stats.total,
    averagePurchaseAmount: stats.average,
    distinctProductsCount: productMap.size,
    mostRecentPurchase: filtered[0] || null,
    topProducts,
    monthlyActivity,
    purchases: filtered
  };
}

export function compareEmployeePurchaseTotals(
  purchases: Purchase[],
  employees: Employee[],
  dateFrom?: string,
  dateTo?: string
): Array<{
  employeeId: string;
  employeeName: string;
  role: string;
  count: number;
  totalAmount: number;
}> {
  const rangePurchases = filterPurchases(purchases, { dateFrom, dateTo });
  const totalsByEmp = new Map<string, { count: number; totalAmount: number }>();

  for (const p of rangePurchases) {
    const key = p.employeeId || '__unassigned__';
    const current = totalsByEmp.get(key) || { count: 0, totalAmount: 0 };
    current.count += 1;
    current.totalAmount += p.totalAmount;
    totalsByEmp.set(key, current);
  }

  const result = employees.map((emp) => {
    const data = totalsByEmp.get(emp.id) || { count: 0, totalAmount: 0 };
    return {
      employeeId: emp.id,
      employeeName: emp.name,
      role: emp.role,
      count: data.count,
      totalAmount: data.totalAmount
    };
  });

  const unassigned = totalsByEmp.get('__unassigned__');
  if (unassigned && unassigned.count > 0) {
    result.push({
      employeeId: '__unassigned__',
      employeeName: 'بدون ثبت مسئول خرید',
      role: 'ثبت‌های پیشین',
      count: unassigned.count,
      totalAmount: unassigned.totalAmount
    });
  }

  return result.sort((a, b) => b.totalAmount - a.totalAmount);
}

export function getEffectiveDayRevenue(record: RevenueDayRecord): number {
  if (!record) return 0;
  if (record.mode === 'detailed') {
    return (record.entries || []).reduce(
      (sum, item) => sum + (Number(item.amount) || 0),
      0
    );
  }
  return Number(record.dailyTotalAmount) || 0;
}

export function getAdjustedDayRevenue(
  record: RevenueDayRecord,
  coefficient: number
): number {
  const safeCoeff =
    Number.isFinite(coefficient) && coefficient > 0 ? coefficient : 0.6;
  return Math.round(getEffectiveDayRevenue(record) * safeCoeff);
}

export function filterRevenueRecords(
  records: RevenueDayRecord[],
  dateFrom?: string,
  dateTo?: string,
  onlyReal?: boolean
): RevenueDayRecord[] {
  const from = dateFrom?.trim() || '';
  const to = dateTo?.trim() || '';
  return [...records]
    .filter((r) => {
      if (onlyReal && r.isDemo) return false;
      if (from && r.date < from) return false;
      if (to && r.date > to) return false;
      return true;
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function calculateRevenueTotal(records: RevenueDayRecord[]): number {
  return records.reduce((sum, r) => sum + getEffectiveDayRevenue(r), 0);
}

export function calculateAdjustedRevenueTotal(
  records: RevenueDayRecord[],
  coefficient: number
): number {
  return records.reduce((sum, r) => sum + getAdjustedDayRevenue(r, coefficient), 0);
}

export interface StaffRevenueAllocationRow {
  employee: Employee;
  rawMinutes: number;
  rawHours: number;
  multiplier: number;
  effectiveHours: number; // e.g., 10 hours * 0.6 = 6 hours
  shareRatio: number;
  allocatedRevenue: number;
}

/**
 * Allocates total revenue to each staff member proportionally based on their
 * individual multiplier: Effective Hours = Worked Hours * Multiplier.
 * Example: 10 hours worked with 0.6 multiplier = 6 effective hours.
 */
export function calculateStaffRevenueAllocations(params: {
  employees: Employee[];
  timesheets: TimesheetEntry[];
  totalRevenue: number;
  dateFrom?: string;
  dateTo?: string;
  onlyReal?: boolean;
}): {
  totalRawHours: number;
  totalEffectiveHours: number;
  rows: StaffRevenueAllocationRow[];
} {
  const from = params.dateFrom?.trim() || '';
  const to = params.dateTo?.trim() || '';

  const draft = params.employees.map((emp) => {
    const empShifts = params.timesheets.filter((t) => {
      if (t.employeeId !== emp.id) return false;
      if (params.onlyReal && t.isDemo) return false;
      if (from && t.date < from) return false;
      if (to && t.date > to) return false;
      return true;
    });

    const rawMinutes = empShifts.reduce((s, t) => s + (Number(t.netMinutes) || 0), 0);
    const rawHours = Number((rawMinutes / 60).toFixed(2));
    const multiplier =
      Number.isFinite(emp.performanceCoefficient) && emp.performanceCoefficient >= 0
        ? emp.performanceCoefficient
        : 1.0;
    const effectiveHours = Number((rawHours * multiplier).toFixed(2));

    return {
      employee: emp,
      rawMinutes,
      rawHours,
      multiplier,
      effectiveHours
    };
  });

  const totalRawHours = Number(
    draft.reduce((s, r) => s + r.rawHours, 0).toFixed(2)
  );
  const totalEffectiveHours = Number(
    draft.reduce((s, r) => s + r.effectiveHours, 0).toFixed(2)
  );

  const rows: StaffRevenueAllocationRow[] = draft.map((r) => {
    const shareRatio =
      totalEffectiveHours > 0 ? r.effectiveHours / totalEffectiveHours : 0;
    const allocatedRevenue =
      totalEffectiveHours > 0 ? Math.round(params.totalRevenue * shareRatio) : 0;
    return {
      ...r,
      shareRatio,
      allocatedRevenue
    };
  });

  return {
    totalRawHours,
    totalEffectiveHours,
    rows
  };
}

export interface PublicRevenueViewData {
  todayAmount: number;
  weekAmount: number;
  monthAmount: number;
  totalAmount: number;
  daysCount: number;
  recentDates: Array<{
    id: string;
    date: string;
    isDemo?: boolean;
  }>;
  dailySeries: Array<{
    id: string;
    date: string;
    amount: number;
    isDemo?: boolean;
  }>;
  monthlySeries: Array<{
    ym: string;
    amount: number;
    days: number;
  }>;
}

export function buildPublicRevenueView(
  records: RevenueDayRecord[],
  coefficient: number = 0.6,
  dateFrom?: string,
  dateTo?: string
): PublicRevenueViewData {
  const todayISO = getTodayISODate();
  const sevenDaysAgoDate = new Date();
  sevenDaysAgoDate.setDate(sevenDaysAgoDate.getDate() - 6);
  const sevenDaysAgoISO = getTodayISODate(sevenDaysAgoDate);
  const currentMonthKey = getJalaliYearMonthKey(todayISO);

  const filtered = filterRevenueRecords(records, dateFrom, dateTo);

  const todayAmount = calculateAdjustedRevenueTotal(
    filterRevenueRecords(records, todayISO, todayISO),
    coefficient
  );
  const weekAmount = calculateAdjustedRevenueTotal(
    filterRevenueRecords(records, sevenDaysAgoISO, todayISO),
    coefficient
  );
  const monthAmount = calculateAdjustedRevenueTotal(
    records.filter((r) => getJalaliYearMonthKey(r.date) === currentMonthKey),
    coefficient
  );
  const totalAmount = calculateAdjustedRevenueTotal(filtered, coefficient);

  const recentDates = filtered.slice(0, 14).map((r) => ({
    id: r.id,
    date: r.date,
    isDemo: r.isDemo
  }));

  const dailySeries = filtered.slice(0, 14).map((r) => ({
    id: r.id,
    date: r.date,
    amount: getAdjustedDayRevenue(r, coefficient),
    isDemo: r.isDemo
  }));

  const monthMap = new Map<string, { ym: string; amount: number; days: number }>();
  for (const r of filtered) {
    const ym = getJalaliYearMonthKey(r.date);
    if (!ym) continue;
    const prev = monthMap.get(ym) || { ym, amount: 0, days: 0 };
    prev.amount += getAdjustedDayRevenue(r, coefficient);
    prev.days += 1;
    monthMap.set(ym, prev);
  }

  const monthlySeries = Array.from(monthMap.values()).sort((a, b) =>
    b.ym.localeCompare(a.ym)
  );

  return {
    todayAmount,
    weekAmount,
    monthAmount,
    totalAmount,
    daysCount: filtered.length,
    recentDates,
    dailySeries,
    monthlySeries
  };
}

export interface FinancialOverviewResult {
  totalRevenue: number;
  totalAdjustedRevenue: number;
  totalPurchases: number;
  totalOperationalExpenses: number;
  estimatedNetOperatingBalance: number;
  revenueDaysCount: number;
  purchasesCount: number;
  expensesCount: number;
}

export function calculateFinancialOverview(params: {
  revenues: RevenueDayRecord[];
  purchases: Purchase[];
  expenses: Expense[];
  coefficient?: number;
  dateFrom?: string;
  dateTo?: string;
  onlyReal?: boolean;
}): FinancialOverviewResult {
  const from = params.dateFrom?.trim() || '';
  const to = params.dateTo?.trim() || '';
  const coeff =
    params.coefficient !== undefined && params.coefficient > 0
      ? params.coefficient
      : 0.6;

  const filteredRevenues = filterRevenueRecords(
    params.revenues,
    from,
    to,
    params.onlyReal
  );
  const filteredPurchases = filterPurchases(params.purchases, {
    dateFrom: from,
    dateTo: to,
    onlyReal: params.onlyReal
  });
  const filteredExpenses = params.expenses.filter((e) => {
    if (params.onlyReal && e.isDemo) return false;
    if (from && e.expenseDate < from) return false;
    if (to && e.expenseDate > to) return false;
    return true;
  });

  const totalRevenue = calculateRevenueTotal(filteredRevenues);
  const totalAdjustedRevenue = calculateAdjustedRevenueTotal(
    filteredRevenues,
    coeff
  );
  const totalPurchases = calculatePurchaseStats(filteredPurchases).total;
  const totalOperationalExpenses = calculateExpensesTotal(filteredExpenses);
  const estimatedNetOperatingBalance =
    totalRevenue - totalPurchases - totalOperationalExpenses;

  return {
    totalRevenue,
    totalAdjustedRevenue,
    totalPurchases,
    totalOperationalExpenses,
    estimatedNetOperatingBalance,
    revenueDaysCount: filteredRevenues.length,
    purchasesCount: filteredPurchases.length,
    expensesCount: filteredExpenses.length
  };
}
