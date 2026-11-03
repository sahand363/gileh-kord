import { dbClient, requestToPromise } from '../db';
import type { Product, Purchase, PurchaseFilterCriteria } from '../../models/types';
import { normalizeProductKey } from '../../utils/formatters';
import { filterPurchases, sortPurchasesDescending } from '../../utils/calculations';

export interface CreatePurchaseInput {
  productName: string;
  quantity: number;
  unit: string;
  totalAmount: number;
  purchaseDate: string;
  supplierName?: string;
  invoiceNumber?: string;
  notes?: string;
}

export class PurchaseRepository {
  public async getAll(): Promise<Purchase[]> {
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
    query?: string
  ): Promise<Purchase[]> {
    const all = await this.getAll();
    const criteria: PurchaseFilterCriteria = {
      dateFrom: startDate,
      dateTo: endDate,
      query
    };
    return filterPurchases(all, criteria);
  }

  /**
   * Atomically creates a purchase record and updates/creates the associated product record
   * within a single readwrite IndexedDB transaction across ['purchases', 'products'].
   */
  public async createPurchaseWithProduct(
    input: CreatePurchaseInput
  ): Promise<{ purchase: Purchase; product: Product }> {
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
          // Only overwrite lastUnit/lastPrice if this purchase is on or after the latest recorded date
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
            totalPurchasesCount: (existingProduct.totalPurchasesCount || 0) + 1
          };
        } else {
          updatedProduct = {
            id: `prod_${crypto.randomUUID()}`,
            name: cleanName,
            normalizedName: normalizedKey,
            lastUnit: input.unit,
            lastPrice: Math.round(input.totalAmount),
            lastPurchaseDate: input.purchaseDate,
            totalPurchasesCount: 1
          };
        }

        const newPurchase: Purchase = {
          id: `purch_${crypto.randomUUID()}`,
          productId: updatedProduct.id,
          productName: updatedProduct.name,
          quantity: input.quantity,
          unit: input.unit,
          totalAmount: Math.round(input.totalAmount),
          currency: 'IRT',
          purchaseDate: input.purchaseDate,
          supplierName: input.supplierName?.trim() || undefined,
          invoiceNumber: input.invoiceNumber?.trim() || undefined,
          notes: input.notes?.trim() || undefined,
          createdAt: now,
          updatedAt: now
        };

        await requestToPromise(productStore.put(updatedProduct));
        await requestToPromise(purchaseStore.add(newPurchase));

        return { purchase: newPurchase, product: updatedProduct };
      }
    );
  }

  public async replaceAll(purchases: Purchase[]): Promise<void> {
    await dbClient.executeTransaction('purchases', 'readwrite', async (stores) => {
      const store = stores['purchases'];
      await requestToPromise(store.clear());
      for (const item of purchases) {
        await requestToPromise(store.add(item));
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
