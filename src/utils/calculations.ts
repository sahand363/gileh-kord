import type {
  Expense,
  InventoryItem,
  Purchase,
  PurchaseFilterCriteria,
  PurchaseSummaryStats
} from '../models/types';

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

  return sortPurchasesDescending(items).filter((item) => {
    if (criteria.onlyReal && item.isDemo) return false;
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
    .sort((a, b) => b.totalAmount - a.totalAmount)
    .slice(0, limit);
}
