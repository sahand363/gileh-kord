import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { purchaseRepository } from '../repositories/PurchaseRepository';
import { productRepository } from '../repositories/ProductRepository';
import { settingsRepository } from '../repositories/SettingsRepository';
import { backupService } from '../BackupService';
import { calculatePurchaseStats, filterPurchases } from '../../utils/calculations';

describe('IndexedDB Repositories, Atomic Transactions & Backup/Restore', () => {
  beforeEach(async () => {
    await purchaseRepository.clear();
    await productRepository.replaceAll([]);
    await settingsRepository.saveSettings({
      serverAddress: '',
      defaultUnit: 'کیلوگرم',
      currency: 'IRT',
      lastSyncAt: null
    });
  });

  it('atomically creates a purchase and updates product history', async () => {
    const { purchase, product } = await purchaseRepository.createPurchaseWithProduct({
      productName: 'برنج هاشمی',
      quantity: 25,
      unit: 'کیلوگرم',
      totalAmount: 4250000,
      purchaseDate: '2026-11-03',
      supplierName: 'برنج‌فروشی شمال',
      invoiceNumber: '۱۰۲۴'
    });

    expect(purchase.id).toBeTruthy();
    expect(product.lastUnit).toBe('کیلوگرم');
    expect(product.lastPrice).toBe(4250000);
    expect(product.totalPurchasesCount).toBe(1);

    // Second purchase of the same product with a newer price and different unit
    await purchaseRepository.createPurchaseWithProduct({
      productName: '  برنج هاشمی ',
      quantity: 2,
      unit: 'کیسه',
      totalAmount: 4500000,
      purchaseDate: '2026-11-04'
    });

    const suggestions = await productRepository.search('برنج');
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].lastUnit).toBe('کیسه');
    expect(suggestions[0].lastPrice).toBe(4500000);
    expect(suggestions[0].totalPurchasesCount).toBe(2);

    // Backdated purchase should increment count without overwriting newer lastUnit/lastPrice
    await purchaseRepository.createPurchaseWithProduct({
      productName: 'برنج هاشمی',
      quantity: 10,
      unit: 'کیلوگرم',
      totalAmount: 1600000,
      purchaseDate: '2026-10-15'
    });

    const updatedSuggestions = await productRepository.search('برنج');
    expect(updatedSuggestions[0].lastUnit).toBe('کیسه');
    expect(updatedSuggestions[0].lastPrice).toBe(4500000);
    expect(updatedSuggestions[0].totalPurchasesCount).toBe(3);
  });

  it('filters purchases by product name and date boundaries and computes accurate totals', async () => {
    await purchaseRepository.createPurchaseWithProduct({
      productName: 'روغن سرخ‌کردنی',
      quantity: 12,
      unit: 'لیتر',
      totalAmount: 1980000,
      purchaseDate: '2026-11-03'
    });
    await purchaseRepository.createPurchaseWithProduct({
      productName: 'مرغ تازه',
      quantity: 18,
      unit: 'کیلوگرم',
      totalAmount: 3240000,
      purchaseDate: '2026-11-02'
    });
    await purchaseRepository.createPurchaseWithProduct({
      productName: 'زعفران',
      quantity: 100,
      unit: 'گرم',
      totalAmount: 8500000,
      purchaseDate: '2026-10-30'
    });

    const all = await purchaseRepository.getAll();
    expect(all).toHaveLength(3);

    const novFiltered = filterPurchases(all, {
      dateFrom: '2026-11-01',
      dateTo: '2026-11-03'
    });
    const novStats = calculatePurchaseStats(novFiltered);
    expect(novStats.count).toBe(2);
    expect(novStats.total).toBe(1980000 + 3240000);
    expect(novStats.average).toBe(Math.round((1980000 + 3240000) / 2));

    const combinedFiltered = filterPurchases(all, {
      query: 'مرغ',
      dateFrom: '2026-11-01',
      dateTo: '2026-11-03'
    });
    expect(combinedFiltered).toHaveLength(1);
    expect(combinedFiltered[0].productName).toBe('مرغ تازه');
  });

  it('exports and atomically restores backups while preserving existing data if validation fails', async () => {
    await purchaseRepository.createPurchaseWithProduct({
      productName: 'گوجه فرنگی',
      quantity: 10,
      unit: 'کیلوگرم',
      totalAmount: 680000,
      purchaseDate: '2026-11-02'
    });

    const exported = await backupService.exportBackup();
    expect(exported.purchases).toHaveLength(1);
    expect(exported.products).toHaveLength(1);

    // Attempt to restore an invalid backup -> must reject and preserve existing data
    await expect(
      backupService.restoreBackup({ version: 1, purchases: [{ id: 'bad' }] })
    ).rejects.toThrow();

    const preserved = await purchaseRepository.getAll();
    expect(preserved).toHaveLength(1);
    expect(preserved[0].productName).toBe('گوجه فرنگی');

    // Restore a valid new backup atomically
    await backupService.restoreBackup({
      version: 1,
      exportedAt: '2026-11-03T12:00:00.000Z',
      purchases: [
        {
          id: 'restored_1',
          productId: 'prod_r1',
          productName: 'ظرف بیرون‌بر',
          quantity: 200,
          unit: 'عدد',
          totalAmount: 1600000,
          currency: 'IRT',
          purchaseDate: '2026-10-29',
          createdAt: '2026-10-29T10:00:00.000Z',
          updatedAt: '2026-10-29T10:00:00.000Z'
        }
      ],
      products: [],
      settings: {
        serverAddress: '',
        defaultUnit: 'عدد',
        currency: 'IRT',
        lastSyncAt: null
      }
    });

    const afterRestore = await purchaseRepository.getAll();
    const settingsAfter = await settingsRepository.getSettings();
    expect(afterRestore).toHaveLength(1);
    expect(afterRestore[0].productName).toBe('ظرف بیرون‌بر');
    expect(settingsAfter.defaultUnit).toBe('عدد');
  });
});
