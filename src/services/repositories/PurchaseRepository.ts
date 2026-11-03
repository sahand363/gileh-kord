import { dbClient } from '../db';
import type { Purchase } from '../../models/types';

export class PurchaseRepository {
  public async getAll(): Promise<Purchase[]> {
    return dbClient.executeTransaction('purchases', 'readonly', async (stores) => {
      const store = stores['purchases'];
      return new Promise<Purchase[]>((resolve, reject) => {
        const request = store.getAll();
        request.onsuccess = () => {
          const items = (request.result as Purchase[]) || [];
          items.sort((a, b) => b.purchaseDate.localeCompare(a.purchaseDate) || b.createdAt.localeCompare(a.createdAt));
          resolve(items);
        };
        request.onerror = () => reject(request.error);
      });
    });
  }

  public async getRecent(limit: number = 4): Promise<Purchase[]> {
    const all = await this.getAll();
    return all.slice(0, limit);
  }

  public async getByDateRange(startDate?: string, endDate?: string, query?: string): Promise<Purchase[]> {
    const all = await this.getAll();
    const normalizedQuery = query?.trim().toLowerCase() || '';

    return all.filter((item) => {
      const matchesQuery = !normalizedQuery || item.productName.toLowerCase().includes(normalizedQuery);
      const matchesStart = !startDate || item.purchaseDate >= startDate;
      const matchesEnd = !endDate || item.purchaseDate <= endDate;
      return matchesQuery && matchesStart && matchesEnd;
    });
  }

  public async create(purchase: Omit<Purchase, 'id' | 'createdAt' | 'updatedAt'>): Promise<Purchase> {
    const now = new Date().toISOString();
    const newPurchase: Purchase = {
      ...purchase,
      id: 'purch_' + crypto.randomUUID(),
      createdAt: now,
      updatedAt: now
    };

    await dbClient.executeTransaction('purchases', 'readwrite', async (stores) => {
      const store = stores['purchases'];
      return new Promise<void>((resolve, reject) => {
        const req = store.add(newPurchase);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    });

    return newPurchase;
  }

  public async replaceAll(purchases: Purchase[]): Promise<void> {
    await dbClient.executeTransaction('purchases', 'readwrite', async (stores) => {
      const store = stores['purchases'];
      return new Promise<void>((resolve, reject) => {
        const clearReq = store.clear();
        clearReq.onerror = () => reject(clearReq.error);
        clearReq.onsuccess = () => {
          let pending = purchases.length;
          if (pending === 0) return resolve();
          for (const item of purchases) {
            const addReq = store.add(item);
            addReq.onerror = () => reject(addReq.error);
            addReq.onsuccess = () => {
              pending--;
              if (pending === 0) resolve();
            };
          }
        };
      });
    });
  }

  public async clear(): Promise<void> {
    await dbClient.executeTransaction('purchases', 'readwrite', async (stores) => {
      const store = stores['purchases'];
      return new Promise<void>((resolve, reject) => {
        const req = store.clear();
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    });
  }
}

export const purchaseRepository = new PurchaseRepository();
