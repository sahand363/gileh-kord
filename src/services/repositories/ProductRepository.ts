import { dbClient } from '../db';
import type { Product } from '../../models/types';

export class ProductRepository {
  public async getAll(): Promise<Product[]> {
    return dbClient.executeTransaction('products', 'readonly', async (stores) => {
      const store = stores['products'];
      return new Promise<Product[]>((resolve, reject) => {
        const request = store.getAll();
        request.onsuccess = () => resolve((request.result as Product[]) || []);
        request.onerror = () => reject(request.error);
      });
    });
  }

  public async search(query: string, limit: number = 5): Promise<Product[]> {
    const all = await this.getAll();
    const term = query.trim().toLowerCase();
    if (!term) return [];
    return all.filter((p) => p.name.toLowerCase().includes(term)).slice(0, limit);
  }

  public async recordPurchase(name: string, unit: string, price: number, purchaseDate: string): Promise<Product> {
    const cleanName = name.trim();
    const existing = await this.findByName(cleanName);

    const product: Product = existing
      ? {
          ...existing,
          lastUnit: unit,
          lastPrice: price,
          lastPurchaseDate: purchaseDate,
          totalPurchasesCount: existing.totalPurchasesCount + 1
        }
      : {
          id: 'prod_' + crypto.randomUUID(),
          name: cleanName,
          lastUnit: unit,
          lastPrice: price,
          lastPurchaseDate: purchaseDate,
          totalPurchasesCount: 1
        };

    await dbClient.executeTransaction('products', 'readwrite', async (stores) => {
      const store = stores['products'];
      return new Promise<void>((resolve, reject) => {
        const req = store.put(product);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    });

    return product;
  }

  public async findByName(name: string): Promise<Product | null> {
    const cleanName = name.trim().toLowerCase();
    return dbClient.executeTransaction('products', 'readonly', async (stores) => {
      const store = stores['products'];
      return new Promise<Product | null>((resolve, reject) => {
        const req = store.openCursor();
        req.onsuccess = (e) => {
          const cursor = (e.target as IDBRequest).result as IDBCursorWithValue;
          if (cursor) {
            const p = cursor.value as Product;
            if (p.name.trim().toLowerCase() === cleanName) {
              return resolve(p);
            }
            cursor.continue();
          } else {
            resolve(null);
          }
        };
        req.onerror = () => reject(req.error);
      });
    });
  }

  public async replaceAll(products: Product[]): Promise<void> {
    await dbClient.executeTransaction('products', 'readwrite', async (stores) => {
      const store = stores['products'];
      return new Promise<void>((resolve, reject) => {
        const clearReq = store.clear();
        clearReq.onerror = () => reject(clearReq.error);
        clearReq.onsuccess = () => {
          let pending = products.length;
          if (pending === 0) return resolve();
          for (const item of products) {
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
}

export const productRepository = new ProductRepository();
