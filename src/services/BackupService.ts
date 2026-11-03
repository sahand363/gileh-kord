import { dbClient, requestToPromise } from './db';
import { purchaseRepository } from './repositories/PurchaseRepository';
import { productRepository } from './repositories/ProductRepository';
import {
  settingsRepository,
  SETTINGS_KEY
} from './repositories/SettingsRepository';
import { validateBackupPayload } from '../utils/validators';
import type { BackupData } from '../models/types';

export class BackupService {
  public async exportBackup(): Promise<BackupData> {
    const [purchases, products, settings] = await Promise.all([
      purchaseRepository.getAll(),
      productRepository.getAll(),
      settingsRepository.getSettings()
    ]);

    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      purchases,
      products,
      settings
    };
  }

  /**
   * Validates and atomically restores all stores in a single readwrite transaction.
   * If validation or any database write fails, existing data is preserved intact.
   */
  public async restoreBackup(rawPayload: unknown): Promise<BackupData> {
    const validation = validateBackupPayload(rawPayload);
    if (!validation.isValid || !validation.normalizedBackup) {
      throw new Error(validation.error || 'فایل پشتیبان نامعتبر است.');
    }

    const backup = validation.normalizedBackup;

    await dbClient.executeTransaction(
      ['purchases', 'products', 'settings'],
      'readwrite',
      async (stores) => {
        const purchaseStore = stores['purchases'];
        const productStore = stores['products'];
        const settingsStore = stores['settings'];

        await requestToPromise(purchaseStore.clear());
        await requestToPromise(productStore.clear());

        for (const product of backup.products) {
          await requestToPromise(productStore.put(product));
        }

        for (const purchase of backup.purchases) {
          await requestToPromise(purchaseStore.add(purchase));
        }

        await requestToPromise(
          settingsStore.put({ key: SETTINGS_KEY, value: backup.settings })
        );
      }
    );

    return backup;
  }
}

export const backupService = new BackupService();
