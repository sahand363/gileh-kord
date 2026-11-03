import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { purchaseRepository } from '../repositories/PurchaseRepository';
import { productRepository } from '../repositories/ProductRepository';
import { settingsRepository } from '../repositories/SettingsRepository';
import { backupService } from '../BackupService';
import {
  loadDemoDataset,
  clearDemoDataset,
  addPurchase
} from '../../stores/purchaseStore';
import { get } from 'svelte/store';
import { purchases, suppliers, inventory } from '../../stores/purchaseStore';

describe('Multi-Store Integration, Demo Dataset Isolation & Backup/Restore', () => {
  beforeEach(async () => {
    await purchaseRepository.clear();
    await productRepository.replaceAll([]);
  });

  it('loads demo dataset with isDemo=true and clears demo items without losing real purchases', async () => {
    await loadDemoDataset();
    expect(get(purchases).length).toBeGreaterThanOrEqual(7);
    expect(get(purchases).every((p) => p.isDemo)).toBe(true);

    // Add a real user purchase
    await addPurchase({
      productName: 'گوشت گوساله تازه',
      quantity: 15,
      unit: 'کیلوگرم',
      price: 9750000,
      purchaseDate: '2026-11-03',
      supplier: 'قصابی نمونه'
    });

    expect(get(purchases).some((p) => !p.isDemo && p.productName === 'گوشت گوساله تازه')).toBe(
      true
    );
    expect(get(suppliers).some((s) => !s.isDemo && s.name === 'قصابی نمونه')).toBe(true);
    expect(
      get(inventory).some((i) => !i.isDemo && i.productName === 'گوشت گوساله تازه')
    ).toBe(true);

    // Clear demo dataset -> only real user records must remain
    await clearDemoDataset();
    const remainingPurchases = get(purchases);
    expect(remainingPurchases).toHaveLength(1);
    expect(remainingPurchases[0].productName).toBe('گوشت گوساله تازه');
    expect(remainingPurchases[0].isDemo).toBeFalsy();
  });

  it('exports and atomically restores all 6 stores via BackupService', async () => {
    await addPurchase({
      productName: 'زعفران سرگل',
      quantity: 50,
      unit: 'گرم',
      price: 4200000,
      purchaseDate: '2026-11-03',
      supplier: 'عطاری رضایی'
    });

    const exported = await backupService.exportBackup();
    expect(exported.version).toBe(2);
    expect(exported.purchases).toHaveLength(1);
    expect(exported.suppliers?.length).toBeGreaterThanOrEqual(1);
    expect(exported.inventory?.length).toBeGreaterThanOrEqual(1);

    await purchaseRepository.clear();
    expect(await purchaseRepository.getAll()).toHaveLength(0);

    await backupService.restoreBackup(exported);
    const restoredPurchases = await purchaseRepository.getAll();
    const restoredSettings = await settingsRepository.getSettings();
    expect(restoredPurchases).toHaveLength(1);
    expect(restoredPurchases[0].productName).toBe('زعفران سرگل');
    expect(restoredSettings.currency).toBe('IRT');
  });
});
