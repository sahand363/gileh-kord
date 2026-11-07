import { dbClient, requestToPromise } from '../db';
import { apiClient } from '../api/apiClient';
import type { Product } from '../../models/types';
import { normalizeProductKey } from '../../utils/formatters';

export class ProductRepository {
  public async getAll(): Promise<Product[]> {
    if (apiClient.isEnabled()) {
      try {
        const remoteItems = await apiClient.listProducts();
        await this.replaceAllLocal(remoteItems);
        return remoteItems;
      } catch {
        // Gracefully fall back to local IndexedDB when offline or backend unreachable
      }
    }
    return this.getAllLocal();
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

    if (apiClient.isEnabled()) {
      try {
        const remote = await apiClient.listProducts(clean);
        return remote.slice(0, limit);
      } catch {
        // Fallback to local search
      }
    }

    const all = await this.getAllLocal();
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
