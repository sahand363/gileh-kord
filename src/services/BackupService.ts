import { ALL_STORES, dbClient, requestToPromise } from './db';
import { purchaseRepository } from './repositories/PurchaseRepository';
import { productRepository } from './repositories/ProductRepository';
import {
  settingsRepository,
  SETTINGS_KEY
} from './repositories/SettingsRepository';
import { validateBackupPayload } from '../utils/validators';
import type {
  BackupData,
  Expense,
  InventoryItem,
  Supplier
} from '../models/types';

export class BackupService {
  private async getStoreItems<T>(storeName: string): Promise<T[]> {
    return dbClient.executeTransaction(storeName, 'readonly', async (stores) => {
      const items = await requestToPromise(stores[storeName].getAll());
      return (items as T[]) || [];
    });
  }

  public async exportBackup(): Promise<BackupData> {
    const [purchases, products, suppliers, inventory, expenses, settings] =
      await Promise.all([
        purchaseRepository.getAll(),
        productRepository.getAll(),
        this.getStoreItems<Supplier>('suppliers'),
        this.getStoreItems<InventoryItem>('inventory'),
        this.getStoreItems<Expense>('expenses'),
        settingsRepository.getSettings()
      ]);

    return {
      version: 2,
      exportedAt: new Date().toISOString(),
      purchases,
      products,
      suppliers,
      inventory,
      expenses,
      settings
    };
  }

  /**
   * Validates and atomically restores all application stores inside a single
   * readwrite transaction. If validation or any write fails, existing data is preserved.
   */
  public async restoreBackup(rawPayload: unknown): Promise<BackupData> {
    const validation = validateBackupPayload(rawPayload);
    if (!validation.isValid || !validation.normalizedBackup) {
      throw new Error(validation.error || 'فایل پشتیبان نامعتبر است.');
    }

    const backup = validation.normalizedBackup;

    await dbClient.executeTransaction(
      [...ALL_STORES],
      'readwrite',
      async (stores) => {
        await requestToPromise(stores['purchases'].clear());
        await requestToPromise(stores['products'].clear());
        await requestToPromise(stores['suppliers'].clear());
        await requestToPromise(stores['inventory'].clear());
        await requestToPromise(stores['expenses'].clear());

        for (const product of backup.products) {
          await requestToPromise(stores['products'].put(product));
        }

        for (const purchase of backup.purchases) {
          await requestToPromise(stores['purchases'].add(purchase));
        }

        for (const supplier of backup.suppliers || []) {
          await requestToPromise(stores['suppliers'].put(supplier));
        }

        for (const invItem of backup.inventory || []) {
          await requestToPromise(stores['inventory'].put(invItem));
        }

        for (const expense of backup.expenses || []) {
          await requestToPromise(stores['expenses'].put(expense));
        }

        await requestToPromise(
          stores['settings'].put({ key: SETTINGS_KEY, value: backup.settings })
        );
      }
    );

    return backup;
  }
}

export const backupService = new BackupService();
