import { writable, derived } from 'svelte/store';
import type { Purchase } from '../models/types';
import { purchaseRepository } from '../services/repositories/PurchaseRepository';
import { getTodayISODate } from '../utils/formatters';
import {
  calculatePurchaseStats,
  sortPurchasesDescending
} from '../utils/calculations';

export const purchases = writable<Purchase[]>([]);
export const isLoading = writable<boolean>(false);
export const dbError = writable<string | null>(null);

export async function loadPurchases(): Promise<void> {
  isLoading.set(true);
  dbError.set(null);
  try {
    const list = await purchaseRepository.getAll();
    purchases.set(list);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'خطا در بارگذاری اطلاعات از پایگاه داده محلی.';
    dbError.set(message);
  } finally {
    isLoading.set(false);
  }
}

export async function addPurchase(data: {
  productName: string;
  quantity: number;
  unit: string;
  price: number;
  purchaseDate: string;
  supplier?: string;
  invoice?: string;
  notes?: string;
}): Promise<Purchase> {
  const { purchase } = await purchaseRepository.createPurchaseWithProduct({
    productName: data.productName,
    quantity: data.quantity,
    unit: data.unit,
    totalAmount: data.price,
    purchaseDate: data.purchaseDate,
    supplierName: data.supplier,
    invoiceNumber: data.invoice,
    notes: data.notes
  });

  purchases.update((prev) => sortPurchasesDescending([purchase, ...prev]));
  return purchase;
}

export const todayPurchasesStats = derived(purchases, ($purchases) => {
  const today = getTodayISODate();
  const todayItems = $purchases.filter((p) => p.purchaseDate === today);
  const stats = calculatePurchaseStats(todayItems);
  return { ...stats, items: todayItems };
});

export const recentPurchases = derived(purchases, ($purchases) => {
  return $purchases.slice(0, 4);
});
