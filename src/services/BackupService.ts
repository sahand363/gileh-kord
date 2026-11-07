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
  Employee,
  Expense,
  InventoryItem,
  MenuItem,
  RevenueDayRecord,
  Supplier,
  TimesheetEntry
} from '../models/types';

export class BackupService {
  private async getStoreItems<T>(storeName: string): Promise<T[]> {
    return dbClient.executeTransaction(storeName, 'readonly', async (stores) => {
      const items = await requestToPromise(stores[storeName].getAll());
      return (items as T[]) || [];
    });
  }

  public async exportBackup(): Promise<BackupData> {
    const [
      purchases,
      products,
      suppliers,
      inventory,
      expenses,
      employees,
      revenues,
      timesheets,
      menuItems,
      settings
    ] = await Promise.all([
      purchaseRepository.getAll(),
      productRepository.getAll(),
      this.getStoreItems<Supplier>('suppliers'),
      this.getStoreItems<InventoryItem>('inventory'),
      this.getStoreItems<Expense>('expenses'),
      this.getStoreItems<Employee>('employees'),
      this.getStoreItems<RevenueDayRecord>('revenues'),
      this.getStoreItems<TimesheetEntry>('timesheets'),
      this.getStoreItems<MenuItem>('menu_items'),
      settingsRepository.getSettings()
    ]);

    return {
      version: 3,
      exportedAt: new Date().toISOString(),
      purchases,
      products,
      suppliers,
      inventory,
      expenses,
      employees,
      revenues,
      timesheets,
      menuItems,
      settings
    };
  }

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
        await requestToPromise(stores['employees'].clear());
        await requestToPromise(stores['revenues'].clear());
        await requestToPromise(stores['timesheets'].clear());
        await requestToPromise(stores['menu_items'].clear());

        for (const emp of backup.employees || []) {
          await requestToPromise(stores['employees'].put(emp));
        }

        for (const product of backup.products) {
          await requestToPromise(stores['products'].put(product));
        }

        for (const purchase of backup.purchases) {
          await requestToPromise(stores['purchases'].put(purchase));
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

        for (const rev of backup.revenues || []) {
          await requestToPromise(stores['revenues'].put(rev));
        }

        for (const ts of backup.timesheets || []) {
          await requestToPromise(stores['timesheets'].put(ts));
        }

        for (const menu of backup.menuItems || []) {
          await requestToPromise(stores['menu_items'].put(menu));
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
