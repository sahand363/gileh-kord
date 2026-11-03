import type {
  Employee,
  Expense,
  InventoryItem,
  Purchase,
  PurchaseFilterCriteria,
  PurchaseSummaryStats,
  RevenueDayRecord
} from '../models/types';
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

export function getLowStockItems(inventory: InventoryItem[]): InventoryItem[] {
  return inventory.filter((item) => item.currentStock <= item.minStockThreshold);
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

/**
 * Returns the effective single-source revenue amount for a given day record.
 * Prevents double-counting:
 * - If mode === 'daily_total', returns `dailyTotalAmount`.
 * - If mode === 'detailed', returns the sum of `entries`.
 */
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

export interface FinancialOverviewResult {
  totalRevenue: number;
  totalPurchases: number;
  totalOperationalExpenses: number;
  estimatedNetOperatingBalance: number;
  revenueDaysCount: number;
  purchasesCount: number;
  expensesCount: number;
}

/**
 * Calculates the transparent financial summary for a given date range:
 * Estimated Net Operating Balance = Total Recorded Revenue - Total Recorded Purchases - Total Recorded Operational Expenses
 */
export function calculateFinancialOverview(params: {
  revenues: RevenueDayRecord[];
  purchases: Purchase[];
  expenses: Expense[];
  dateFrom?: string;
  dateTo?: string;
  onlyReal?: boolean;
}): FinancialOverviewResult {
  const from = params.dateFrom?.trim() || '';
  const to = params.dateTo?.trim() || '';

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
  const totalPurchases = calculatePurchaseStats(filteredPurchases).total;
  const totalOperationalExpenses = calculateExpensesTotal(filteredExpenses);
  const estimatedNetOperatingBalance =
    totalRevenue - totalPurchases - totalOperationalExpenses;

  return {
    totalRevenue,
    totalPurchases,
    totalOperationalExpenses,
    estimatedNetOperatingBalance,
    revenueDaysCount: filteredRevenues.length,
    purchasesCount: filteredPurchases.length,
    expensesCount: filteredExpenses.length
  };
}
