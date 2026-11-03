import { writable, derived } from 'svelte/store';
import type { Purchase } from '../models/types';
import { purchaseRepository } from '../services/repositories/PurchaseRepository';
import { productRepository } from '../services/repositories/ProductRepository';
import { getTodayISODate } from '../utils/formatters';

export const purchases = writable<Purchase[]>([]);
export const isLoading = writable<boolean>(false);

export async function loadPurchases() {
  isLoading.set(true);
  try {
    const list = await purchaseRepository.getAll();
    purchases.set(list);
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
}) {
  const product = await productRepository.recordPurchase(
    data.productName,
    data.unit,
    data.price,
    data.purchaseDate
  );

  const created = await purchaseRepository.create({
    productId: product.id,
    productName: data.productName.trim(),
    quantity: data.quantity,
    unit: data.unit,
    totalAmount: data.price,
    currency: 'IRT',
    purchaseDate: data.purchaseDate,
    supplierName: data.supplier?.trim() || undefined,
    invoiceNumber: data.invoice?.trim() || undefined,
    notes: data.notes?.trim() || undefined
  });

  purchases.update((prev) => [created, ...prev]);
  return created;
}

export const todayPurchasesStats = derived(purchases, ($purchases) => {
  const today = getTodayISODate();
  const todayItems = $purchases.filter((p) => p.purchaseDate === today);
  const count = todayItems.length;
  const total = todayItems.reduce((sum, p) => sum + p.totalAmount, 0);
  const average = count > 0 ? Math.round(total / count) : 0;
  return { count, total, average, items: todayItems };
});

export const recentPurchases = derived(purchases, ($purchases) => {
  return $purchases.slice(0, 4);
});
