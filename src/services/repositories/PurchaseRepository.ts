import { dbClient, requestToPromise } from '../db';
import { apiClient } from '../api/apiClient';
import type { Product, Purchase, PurchaseFilterCriteria } from '../../models/types';
import { normalizeProductKey } from '../../utils/formatters';
import { filterPurchases, sortPurchasesDescending } from '../../utils/calculations';
import { generateId } from '../../utils/uuid';

export interface CreatePurchaseInput {
  productName: string;
  quantity: number;
  unit: string;
  totalAmount: number;
  purchaseDate: string;
  employeeId?: string;
  employeeNameSnapshot?: string;
  supplierName?: string;
  invoiceNumber?: string;
  notes?: string;
}

export interface UpdatePurchaseInput {
  productName: string;
  quantity: number;
  unit: string;
  totalAmount: number;
  purchaseDate: string;
  employeeId?: string;
  employeeNameSnapshot?: string;
  supplierName?: string;
  invoiceNumber?: string;
  notes?: string;
}

export class PurchaseRepository {
  public async getAll(): Promise<Purchase[]> {
    const localItems = await this.getAllLocal();

    if (apiClient.isEnabled()) {
      try {
        const remoteItems = await apiClient.listPurchases({ pageSize: 500 });
        if (remoteItems.length > 0) {
          const merged = this.mergePurchases(localItems, remoteItems);
          await this.replaceAllLocal(merged);
          return merged;
        }
      } catch {
        // Fallback to local IndexedDB when offline
      }
    }
    return localItems;
  }

  private mergePurchases(local: Purchase[], remote: Purchase[]): Purchase[] {
    const map = new Map<string, Purchase>();
    for (const item of local) {
      map.set(item.id, item);
    }
    for (const item of remote) {
      map.set(item.id, item);
    }
    return sortPurchasesDescending(Array.from(map.values()));
  }

  private async getAllLocal(): Promise<Purchase[]> {
    return dbClient.executeTransaction('purchases', 'readonly', async (stores) => {
      const items = (await requestToPromise(stores['purchases'].getAll())) as Purchase[];
      return sortPurchasesDescending(items || []);
    });
  }

  public async getRecent(limit: number = 4): Promise<Purchase[]> {
    const all = await this.getAll();
    return all.slice(0, limit);
  }

  public async getByDateRange(
    startDate?: string,
    endDate?: string,
    query?: string,
    employeeId?: string
  ): Promise<Purchase[]> {
    const all = await this.getAll();
    const criteria: PurchaseFilterCriteria = {
      dateFrom: startDate,
      dateTo: endDate,
      query,
      employeeId
    };
    return filterPurchases(all, criteria);
  }

  public async createPurchaseWithProduct(
    input: CreatePurchaseInput
  ): Promise<{ purchase: Purchase; product: Product }> {
    if (apiClient.isEnabled()) {
      try {
        const remoteRes = await apiClient.createPurchase({
          productName: input.productName,
          quantity: input.quantity,
          unit: input.unit,
          totalAmount: Math.round(input.totalAmount),
          purchaseDate: input.purchaseDate,
          employeeId: input.employeeId,
          employeeNameSnapshot: input.employeeNameSnapshot,
          supplierName: input.supplierName,
          invoiceNumber: input.invoiceNumber,
          notes: input.notes
        });

        await dbClient.executeTransaction(
          ['purchases', 'products'],
          'readwrite',
          async (stores) => {
            if (remoteRes.product) {
              await requestToPromise(stores['products'].put(remoteRes.product));
            }
            await requestToPromise(stores['purchases'].put(remoteRes.purchase));
          }
        );

        return remoteRes;
      } catch {
        // Fall through to local IndexedDB transaction if offline
      }
    }

    const cleanName = input.productName.trim().replace(/\s+/g, ' ');
    const normalizedKey = normalizeProductKey(cleanName);
    const now = new Date().toISOString();

    return dbClient.executeTransaction(
      ['purchases', 'products'],
      'readwrite',
      async (stores) => {
        const purchaseStore = stores['purchases'];
        const productStore = stores['products'];

        const allProducts = (await requestToPromise(
          productStore.getAll()
        )) as Product[];
        const existingProduct =
          allProducts.find(
            (p) => (p.normalizedName || normalizeProductKey(p.name)) === normalizedKey
          ) || null;

        let updatedProduct: Product;
        if (existingProduct) {
          const isNewerOrSameDate =
            input.purchaseDate >= existingProduct.lastPurchaseDate;

          updatedProduct = {
            ...existingProduct,
            name: existingProduct.name,
            normalizedName: normalizedKey,
            lastUnit: isNewerOrSameDate ? input.unit : existingProduct.lastUnit,
            lastPrice: isNewerOrSameDate
              ? Math.round(input.totalAmount)
              : existingProduct.lastPrice,
            lastPurchaseDate: isNewerOrSameDate
              ? input.purchaseDate
              : existingProduct.lastPurchaseDate,
            totalPurchasesCount: (existingProduct.totalPurchasesCount || 0) + 1,
            isDemo: false
          };
        } else {
          updatedProduct = {
            id: generateId('prod'),
            name: cleanName,
            normalizedName: normalizedKey,
            lastUnit: input.unit,
            lastPrice: Math.round(input.totalAmount),
            lastPurchaseDate: input.purchaseDate,
            totalPurchasesCount: 1,
            isDemo: false
          };
        }

        const newPurchase: Purchase = {
          id: generateId('purch'),
          productId: updatedProduct.id,
          productName: updatedProduct.name,
          quantity: input.quantity,
          unit: input.unit,
          totalAmount: Math.round(input.totalAmount),
          currency: 'IRT',
          purchaseDate: input.purchaseDate,
          employeeId: input.employeeId?.trim() || undefined,
          employeeNameSnapshot: input.employeeNameSnapshot?.trim() || undefined,
          supplierName: input.supplierName?.trim() || undefined,
          invoiceNumber: input.invoiceNumber?.trim() || undefined,
          notes: input.notes?.trim() || undefined,
          isDemo: false,
          createdAt: now,
          updatedAt: now
        };

        await requestToPromise(productStore.put(updatedProduct));
        await requestToPromise(purchaseStore.add(newPurchase));

        return { purchase: newPurchase, product: updatedProduct };
      }
    );
  }

  public async updatePurchase(
    id: string,
    updates: UpdatePurchaseInput
  ): Promise<Purchase> {
    if (apiClient.isEnabled()) {
      try {
        const remoteUpdated = await apiClient.updatePurchase(id, {
          productName: updates.productName,
          quantity: updates.quantity,
          unit: updates.unit,
          totalAmount: Math.round(updates.totalAmount),
          purchaseDate: updates.purchaseDate,
          employeeId: updates.employeeId,
          employeeNameSnapshot: updates.employeeNameSnapshot,
          supplierName: updates.supplierName,
          invoiceNumber: updates.invoiceNumber,
          notes: updates.notes
        });

        await dbClient.executeTransaction('purchases', 'readwrite', async (stores) => {
          await requestToPromise(stores['purchases'].put(remoteUpdated));
        });

        return remoteUpdated;
      } catch {
        // Fallback to local update if offline
      }
    }

    const cleanName = updates.productName.trim().replace(/\s+/g, ' ');
    const normalizedKey = normalizeProductKey(cleanName);
    const now = new Date().toISOString();

    return dbClient.executeTransaction(
      ['purchases', 'products'],
      'readwrite',
      async (stores) => {
        const purchaseStore = stores['purchases'];
        const productStore = stores['products'];

        const existing = (await requestToPromise(
          purchaseStore.get(id)
        )) as Purchase | undefined;
        if (!existing) {
          throw new Error('فاکتور خرید مورد نظر یافت نشد.');
        }

        const allProducts = (await requestToPromise(
          productStore.getAll()
        )) as Product[];
        let targetProduct =
          allProducts.find(
            (p) => (p.normalizedName || normalizeProductKey(p.name)) === normalizedKey
          ) || null;

        if (targetProduct) {
          const isNewerOrSame =
            updates.purchaseDate >= targetProduct.lastPurchaseDate;
          targetProduct = {
            ...targetProduct,
            lastUnit: isNewerOrSame ? updates.unit : targetProduct.lastUnit,
            lastPrice: isNewerOrSame
              ? Math.round(updates.totalAmount)
              : targetProduct.lastPrice,
            lastPurchaseDate: isNewerOrSame
              ? updates.purchaseDate
              : targetProduct.lastPurchaseDate,
            isDemo: false
          };
          await requestToPromise(productStore.put(targetProduct));
        } else {
          targetProduct = {
            id: generateId('prod'),
            name: cleanName,
            normalizedName: normalizedKey,
            lastUnit: updates.unit,
            lastPrice: Math.round(updates.totalAmount),
            lastPurchaseDate: updates.purchaseDate,
            totalPurchasesCount: 1,
            isDemo: false
          };
          await requestToPromise(productStore.put(targetProduct));
        }

        const updatedPurchase: Purchase = {
          ...existing,
          productId: targetProduct.id,
          productName: cleanName,
          quantity: updates.quantity,
          unit: updates.unit,
          totalAmount: Math.round(updates.totalAmount),
          purchaseDate: updates.purchaseDate,
          employeeId:
            updates.employeeId !== undefined
              ? updates.employeeId.trim() || undefined
              : existing.employeeId,
          employeeNameSnapshot:
            updates.employeeNameSnapshot !== undefined
              ? updates.employeeNameSnapshot.trim() || undefined
              : existing.employeeNameSnapshot,
          supplierName: updates.supplierName?.trim() || undefined,
          invoiceNumber: updates.invoiceNumber?.trim() || undefined,
          notes: updates.notes?.trim() || undefined,
          isDemo: false,
          updatedAt: now
        };

        await requestToPromise(purchaseStore.put(updatedPurchase));
        return updatedPurchase;
      }
    );
  }

  public async replaceAll(purchases: Purchase[]): Promise<void> {
    await this.replaceAllLocal(purchases);
  }

  private async replaceAllLocal(purchases: Purchase[]): Promise<void> {
    await dbClient.executeTransaction('purchases', 'readwrite', async (stores) => {
      const store = stores['purchases'];
      await requestToPromise(store.clear());
      for (const item of purchases) {
        await requestToPromise(store.put(item));
      }
    });
  }

  public async clear(): Promise<void> {
    await dbClient.executeTransaction('purchases', 'readwrite', async (stores) => {
      await requestToPromise(stores['purchases'].clear());
    });
  }
}

export const purchaseRepository = new PurchaseRepository();
