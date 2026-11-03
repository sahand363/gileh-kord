import type {
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

  return sortPurchasesDescending(items).filter((item) => {
    const matchesQuery =
      !query || item.productName.toLocaleLowerCase('fa-IR').includes(query);
    const matchesFrom = !dateFrom || item.purchaseDate >= dateFrom;
    const matchesTo = !dateTo || item.purchaseDate <= dateTo;
    return matchesQuery && matchesFrom && matchesTo;
  });
}

export function calculatePurchaseStats(items: Purchase[]): PurchaseSummaryStats {
  const count = items.length;
  const total = items.reduce((sum, item) => sum + (Number(item.totalAmount) || 0), 0);
  const average = count > 0 ? Math.round(total / count) : 0;
  return { count, total, average };
}
