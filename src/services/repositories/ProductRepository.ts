import { dbClient, requestToPromise } from '../db';
import type { Product } from '../../models/types';
import { normalizeProductKey } from '../../utils/formatters';

export class ProductRepository {
  public async getAll(): Promise<Product[]> {
    return dbClient.executeTransaction('products', 'readonly', async (stores) => {
      const items = (await requestToPromise(stores['products'].getAll())) as Product[];
      return (items || []).sort((a, b) =>
        b.lastPurchaseDate.localeCompare(a.lastPurchaseDate)
      );
    });
  }

  public async search(query: string, limit: number = 5): Promise<Product[]> {
    const term = normalizeProductKey(query);
    if (!term) return [];
    const all = await this.getAll();
    return all
      .filter((p) => normalizeProductKey(p.name).includes(term))
      .slice(0, limit);
  }

  public async findByName(name: string): Promise<Product | null> {
    const targetKey = normalizeProductKey(name);
    if (!targetKey) return null;

    return dbClient.executeTransaction('products', 'readonly', async (stores) => {
      const all = (await requestToPromise(stores['products'].getAll())) as Product[];
      return (
        all.find((p) => (p.normalizedName || normalizeProductKey(p.name)) === targetKey) ||
        null
      );
    });
  }

  public async replaceAll(products: Product[]): Promise<void> {
    await dbClient.executeTransaction('products', 'readwrite', async (stores) => {
      const store = stores['products'];
      await requestToPromise(store.clear());
      for (const item of products) {
        const normalized: Product = {
          ...item,
          name: item.name.trim(),
          normalizedName: item.normalizedName || normalizeProductKey(item.name)
        };
        await requestToPromise(store.put(normalized));
      }
    });
  }
}

export const productRepository = new ProductRepository();
