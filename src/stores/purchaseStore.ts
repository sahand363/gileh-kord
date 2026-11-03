import { writable, derived } from 'svelte/store';
import type {
  ApplicationSettings,
  Expense,
  InventoryItem,
  Product,
  Purchase,
  Supplier
} from '../models/types';
import { purchaseRepository } from '../services/repositories/PurchaseRepository';
import { productRepository } from '../services/repositories/ProductRepository';
import {
  DEFAULT_SETTINGS,
  settingsRepository,
  SETTINGS_KEY
} from '../services/repositories/SettingsRepository';
import { ALL_STORES, dbClient, requestToPromise } from '../services/db';
import { createInitialDemoDataset } from '../services/demoData';
import { getTodayISODate, normalizeProductKey } from '../utils/formatters';
import {
  calculateExpensesTotal,
  calculatePurchaseStats,
  getLowStockItems,
  sortPurchasesDescending
} from '../utils/calculations';

export const purchases = writable<Purchase[]>([]);
export const products = writable<Product[]>([]);
export const suppliers = writable<Supplier[]>([]);
export const inventory = writable<InventoryItem[]>([]);
export const expenses = writable<Expense[]>([]);
export const appSettings = writable<ApplicationSettings>({ ...DEFAULT_SETTINGS });
export const isLoading = writable<boolean>(false);
export const dbError = writable<string | null>(null);

async function readStoreAll<T>(storeName: string): Promise<T[]> {
  return dbClient.executeTransaction(storeName, 'readonly', async (stores) => {
    const res = await requestToPromise(stores[storeName].getAll());
    return (res as T[]) || [];
  });
}

/**
 * Loads all application stores from IndexedDB.
 * On the very first visit (when `demoSeedInitialized` is false and DB is empty),
 * automatically populates the clearly-labeled demo dataset (`isDemo: true`)
 * so all 10 pages are visually rich and interactive out of the box.
 */
export async function loadPurchases(autoSeedDemoIfFirstRun = false): Promise<void> {
  isLoading.set(true);
  dbError.set(null);
  try {
    let settings = await settingsRepository.getSettings();
    let [purchasesList, productsList, suppliersList, inventoryList, expensesList] =
      await Promise.all([
        purchaseRepository.getAll(),
        productRepository.getAll(),
        readStoreAll<Supplier>('suppliers'),
        readStoreAll<InventoryItem>('inventory'),
        readStoreAll<Expense>('expenses')
      ]);

    if (
      autoSeedDemoIfFirstRun &&
      !settings.demoSeedInitialized &&
      purchasesList.length === 0
    ) {
      await loadDemoDataset();
      return;
    }

    purchases.set(purchasesList);
    products.set(productsList);
    suppliers.set(suppliersList);
    inventory.set(inventoryList);
    expenses.set(
      expensesList.sort((a, b) => b.expenseDate.localeCompare(a.expenseDate))
    );
    appSettings.set(settings);
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : 'خطا در بارگذاری اطلاعات از پایگاه داده محلی.';
    dbError.set(message);
  } finally {
    isLoading.set(false);
  }
}

/**
 * Populates or resets the clearly-badged demonstration records (`isDemo: true`)
 * without deleting any real user-created records (`isDemo !== true`).
 */
export async function loadDemoDataset(): Promise<void> {
  const demo = createInitialDemoDataset();
  const currentSettings = await settingsRepository.getSettings();
  const updatedSettings: ApplicationSettings = {
    ...currentSettings,
    demoSeedInitialized: true
  };

  await dbClient.executeTransaction(
    [...ALL_STORES],
    'readwrite',
    async (stores) => {
      for (const item of demo.purchases) {
        await requestToPromise(stores['purchases'].put(item));
      }
      for (const item of demo.products) {
        await requestToPromise(stores['products'].put(item));
      }
      for (const item of demo.suppliers) {
        await requestToPromise(stores['suppliers'].put(item));
      }
      for (const item of demo.inventory) {
        await requestToPromise(stores['inventory'].put(item));
      }
      for (const item of demo.expenses) {
        await requestToPromise(stores['expenses'].put(item));
      }
      await requestToPromise(
        stores['settings'].put({ key: SETTINGS_KEY, value: updatedSettings })
      );
    }
  );

  await loadPurchases(false);
}

/**
 * Removes only demonstration records (`isDemo: true`) across all stores,
 * preserving all real user-entered records.
 */
export async function clearDemoDataset(): Promise<void> {
  const currentSettings = await settingsRepository.getSettings();
  const updatedSettings: ApplicationSettings = {
    ...currentSettings,
    demoSeedInitialized: true
  };

  await dbClient.executeTransaction(
    [...ALL_STORES],
    'readwrite',
    async (stores) => {
      const storeNames = [
        'purchases',
        'products',
        'suppliers',
        'inventory',
        'expenses'
      ] as const;

      for (const name of storeNames) {
        const all = (await requestToPromise(stores[name].getAll())) as Array<{
          id: string;
          isDemo?: boolean;
        }>;
        for (const record of all) {
          if (record.isDemo) {
            await requestToPromise(stores[name].delete(record.id));
          }
        }
      }

      await requestToPromise(
        stores['settings'].put({ key: SETTINGS_KEY, value: updatedSettings })
      );
    }
  );

  await loadPurchases(false);
}

/**
 * Creates a real user purchase (`isDemo: false`) and atomically updates:
 * 1. `purchases` store
 * 2. `products` store (autocomplete & price history)
 * 3. `suppliers` store (if supplier name is provided)
 * 4. `inventory` store (increments stock for matching product)
 */
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

  // Also sync Suppliers and Inventory stores so all 10 sections reflect the new purchase
  await dbClient.executeTransaction(
    ['suppliers', 'inventory'],
    'readwrite',
    async (stores) => {
      const supplierName = data.supplier?.trim();
      if (supplierName) {
        const allSuppliers = (await requestToPromise(
          stores['suppliers'].getAll()
        )) as Supplier[];
        const existingSup = allSuppliers.find(
          (s) => normalizeProductKey(s.name) === normalizeProductKey(supplierName)
        );
        if (existingSup) {
          await requestToPromise(
            stores['suppliers'].put({
              ...existingSup,
              lastPurchaseDate:
                !existingSup.lastPurchaseDate ||
                data.purchaseDate >= existingSup.lastPurchaseDate
                  ? data.purchaseDate
                  : existingSup.lastPurchaseDate,
              totalPurchasesAmount: existingSup.totalPurchasesAmount + data.price,
              purchasesCount: existingSup.purchasesCount + 1,
              isDemo: false
            })
          );
        } else {
          await requestToPromise(
            stores['suppliers'].put({
              id: `sup_${crypto.randomUUID()}`,
              name: supplierName,
              category: 'تأمین‌کننده عمومی',
              phone: 'ثبت‌نشده',
              city: 'محلی',
              lastPurchaseDate: data.purchaseDate,
              totalPurchasesAmount: data.price,
              purchasesCount: 1,
              isDemo: false
            })
          );
        }
      }

      const allInventory = (await requestToPromise(
        stores['inventory'].getAll()
      )) as InventoryItem[];
      const existingInv = allInventory.find(
        (inv) =>
          normalizeProductKey(inv.productName) ===
          normalizeProductKey(data.productName)
      );
      if (existingInv) {
        await requestToPromise(
          stores['inventory'].put({
            ...existingInv,
            currentStock: Number(
              (existingInv.currentStock + data.quantity).toFixed(3)
            ),
            unit: data.unit,
            lastUpdated: data.purchaseDate,
            isDemo: false
          })
        );
      } else {
        await requestToPromise(
          stores['inventory'].put({
            id: `inv_${crypto.randomUUID()}`,
            productName: data.productName.trim(),
            category: 'مواد اولیه',
            currentStock: data.quantity,
            minStockThreshold: Math.max(1, Math.round(data.quantity * 0.25)),
            unit: data.unit,
            lastUpdated: data.purchaseDate,
            isDemo: false
          })
        );
      }
    }
  );

  await loadPurchases(false);
  return purchase;
}

export async function addSupplier(input: {
  name: string;
  category: string;
  phone: string;
  city: string;
  notes?: string;
}): Promise<Supplier> {
  const newSupplier: Supplier = {
    id: `sup_${crypto.randomUUID()}`,
    name: input.name.trim(),
    category: input.category.trim() || 'عمومی',
    phone: input.phone.trim() || 'ثبت‌نشده',
    city: input.city.trim() || 'رشت',
    notes: input.notes?.trim() || undefined,
    totalPurchasesAmount: 0,
    purchasesCount: 0,
    isDemo: false
  };

  await dbClient.executeTransaction('suppliers', 'readwrite', async (stores) => {
    await requestToPromise(stores['suppliers'].put(newSupplier));
  });

  await loadPurchases(false);
  return newSupplier;
}

export async function updateInventoryStock(
  id: string,
  delta: number
): Promise<void> {
  await dbClient.executeTransaction('inventory', 'readwrite', async (stores) => {
    const existing = (await requestToPromise(
      stores['inventory'].get(id)
    )) as InventoryItem | undefined;
    if (!existing) return;
    const updated: InventoryItem = {
      ...existing,
      currentStock: Math.max(0, Number((existing.currentStock + delta).toFixed(3))),
      lastUpdated: getTodayISODate(),
      isDemo: false
    };
    await requestToPromise(stores['inventory'].put(updated));
  });
  await loadPurchases(false);
}

export async function addInventoryItem(input: {
  productName: string;
  category: string;
  currentStock: number;
  minStockThreshold: number;
  unit: string;
}): Promise<void> {
  const item: InventoryItem = {
    id: `inv_${crypto.randomUUID()}`,
    productName: input.productName.trim(),
    category: input.category.trim() || 'مواد اولیه',
    currentStock: input.currentStock,
    minStockThreshold: input.minStockThreshold,
    unit: input.unit,
    lastUpdated: getTodayISODate(),
    isDemo: false
  };
  await dbClient.executeTransaction('inventory', 'readwrite', async (stores) => {
    await requestToPromise(stores['inventory'].put(item));
  });
  await loadPurchases(false);
}

export async function addExpense(input: {
  title: string;
  category: string;
  amount: number;
  expenseDate: string;
  notes?: string;
}): Promise<Expense> {
  const expense: Expense = {
    id: `exp_${crypto.randomUUID()}`,
    title: input.title.trim(),
    category: input.category,
    amount: Math.round(input.amount),
    expenseDate: input.expenseDate,
    notes: input.notes?.trim() || undefined,
    isDemo: false,
    createdAt: new Date().toISOString()
  };

  await dbClient.executeTransaction('expenses', 'readwrite', async (stores) => {
    await requestToPromise(stores['expenses'].put(expense));
  });

  await loadPurchases(false);
  return expense;
}

export const todayPurchasesStats = derived(purchases, ($purchases) => {
  const today = getTodayISODate();
  const todayItems = $purchases.filter((p) => p.purchaseDate === today);
  const stats = calculatePurchaseStats(todayItems);
  return { ...stats, items: todayItems };
});

export const recentPurchases = derived(purchases, ($purchases) => {
  return sortPurchasesDescending($purchases).slice(0, 4);
});

export const dashboardSummary = derived(
  [purchases, products, suppliers, inventory, expenses],
  ([$purchases, $products, $suppliers, $inventory, $expenses]) => {
    const allPurchaseStats = calculatePurchaseStats($purchases);
    const demoCount = $purchases.filter((p) => p.isDemo).length;
    const realCount = $purchases.length - demoCount;
    const lowStock = getLowStockItems($inventory);
    const totalExpenses = calculateExpensesTotal($expenses);

    return {
      totalPurchasesAmount: allPurchaseStats.total,
      totalPurchasesCount: allPurchaseStats.count,
      averagePurchaseAmount: allPurchaseStats.average,
      demoCount,
      realCount,
      productsCount: $products.length,
      suppliersCount: $suppliers.length,
      lowStockItems: lowStock,
      totalExpenses,
      combinedOutflow: allPurchaseStats.total + totalExpenses
    };
  }
);
