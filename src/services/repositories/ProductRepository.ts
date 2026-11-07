import { dbClient, requestToPromise } from '../db';
import { apiClient } from '../api/apiClient';
import type { Product } from '../../models/types';
import { normalizeProductKey } from '../../utils/formatters';

export class ProductRepository {
  public async getAll(): Promise<Product[]> {
    const localItems = await this.getAllLocal();

    if (apiClient.isEnabled()) {
      try {
        const remoteItems = await apiClient.listProducts();
        if (remoteItems.length > 0) {
          const merged = this.mergeProducts(localItems, remoteItems);
          await this.replaceAllLocal(merged);
          return merged;
        }
      } catch {
        // Fallback to local IndexedDB when offline or server unreachable
      }
    }
    return localItems;
  }

  private mergeProducts(local: Product[], remote: Product[]): Product[] {
    const map = new Map<string, Product>();
    for (const item of local) {
      map.set(item.normalizedName || normalizeProductKey(item.name), item);
    }
    for (const item of remote) {
      map.set(item.normalizedName || normalizeProductKey(item.name), item);
    }
    return Array.from(map.values()).sort((a, b) =>
      b.lastPurchaseDate.localeCompare(a.lastPurchaseDate)
    );
  }

  private async getAllLocal(): Promise<Product[]> {
    return dbClient.executeTransaction('products', 'readonly', async (stores) => {
      const items = (await requestToPromise(stores['products'].getAll())) as Product[];
      return (items || []).sort((a, b) =>
        b.lastPurchaseDate.localeCompare(a.lastPurchaseDate)
      );
    });
  }

  public async search(query: string, limit: number = 5): Promise<Product[]> {
    const clean = normalizeProductKey(query);
    if (!clean) return [];

    const all = await this.getAll();
    return all
      .filter((p) => {
        const norm = p.normalizedName || normalizeProductKey(p.name);
        return norm.includes(clean);
      })
      .slice(0, limit);
  }

  public async replaceAll(products: Product[]): Promise<void> {
    await this.replaceAllLocal(products);
  }

  private async replaceAllLocal(products: Product[]): Promise<void> {
    await dbClient.executeTransaction('products', 'readwrite', async (stores) => {
      const store = stores['products'];
      await requestToPromise(store.clear());
      for (const item of products) {
        await requestToPromise(store.put(item));
      }
    });
  }
}

export const productRepository = new ProductRepository();
