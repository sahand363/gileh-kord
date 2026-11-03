import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { purchaseRepository } from '../repositories/PurchaseRepository';
import { productRepository } from '../repositories/ProductRepository';
import { backupService } from '../BackupService';
import {
  loadDemoDataset,
  clearDemoDataset,
  addPurchase,
  purchases
} from '../../stores/purchaseStore';
import { registerAppServiceWorker } from '../pwaService';
import { filterPurchases } from '../../utils/calculations';
import { parseJalaliInputToISO } from '../../utils/jalali';
import { get } from 'svelte/store';

describe('HTTP-Compatible Purchase Creation, Jalali Filtering & Service Worker Fallback', () => {
  beforeEach(async () => {
    await purchaseRepository.clear();
    await productRepository.replaceAll([]);
  });

  it('creates purchases and products when crypto.randomUUID is unavailable (HTTP IP condition)', async () => {
    const originalRandomUUID = globalThis.crypto?.randomUUID;
    try {
      if (globalThis.crypto) {
        // Simulate insecure HTTP IP context where crypto.randomUUID is undefined
        Object.defineProperty(globalThis.crypto, 'randomUUID', {
          value: undefined,
          configurable: true,
          writable: true
        });
      }

      const created = await addPurchase({
        productName: 'برنج هاشمی درجه یک',
        quantity: 30,
        unit: 'کیلوگرم',
        price: 5100000,
        purchaseDate: '2026-11-03',
        supplier: 'برنج‌فروشی شمال'
      });

      expect(created.id).toMatch(/^purch_/);
      expect(get(purchases)).toHaveLength(1);
      expect(get(purchases)[0].productName).toBe('برنج هاشمی درجه یک');
    } finally {
      if (globalThis.crypto && originalRandomUUID) {
        Object.defineProperty(globalThis.crypto, 'randomUUID', {
          value: originalRandomUUID,
          configurable: true,
          writable: true
        });
      }
    }
  });

  it('filters purchases accurately using Jalali date boundaries', async () => {
    // 1405/08/10 -> 2026-11-01, 1405/08/11 -> 2026-11-02, 1405/08/12 -> 2026-11-03
    const d1 = parseJalaliInputToISO('۱۴۰۵/۰۸/۱۰')!;
    const d2 = parseJalaliInputToISO('۱۴۰۵/۰۸/۱۱')!;
    const d3 = parseJalaliInputToISO('۱۴۰۵/۰۸/۱۲')!;

    await addPurchase({
      productName: 'زعفران',
      quantity: 50,
      unit: 'گرم',
      price: 4250000,
      purchaseDate: d1
    });
    await addPurchase({
      productName: 'مرغ تازه',
      quantity: 20,
      unit: 'کیلوگرم',
      price: 3600000,
      purchaseDate: d2
    });
    await addPurchase({
      productName: 'روغن سرخ‌کردنی',
      quantity: 10,
      unit: 'لیتر',
      price: 1650000,
      purchaseDate: d3
    });

    const filtered = filterPurchases(get(purchases), {
      dateFrom: parseJalaliInputToISO('۱۴۰۵/۰۸/۱۱')!,
      dateTo: parseJalaliInputToISO('۱۴۰۵/۰۸/۱۲')!
    });

    expect(filtered).toHaveLength(2);
    expect(filtered.map((p) => p.productName)).toEqual(['روغن سرخ‌کردنی', 'مرغ تازه']);
  });

  it('gracefully skips Service Worker registration on HTTP IP without throwing', async () => {
    const status = await registerAppServiceWorker({
      isProd: true,
      win: {
        location: { protocol: 'http:', hostname: '94.184.6.138' },
        isSecureContext: false
      } as unknown as Window & typeof globalThis,
      nav: {} as Navigator
    });

    expect(status).toBe('unsupported-http');
  });

  it('preserves Jalali-compatible ISO dates across backup export and atomic restore', async () => {
    await loadDemoDataset();
    await clearDemoDataset();

    const jalaliDateISO = parseJalaliInputToISO('۱۴۰۵/۰۸/۱۲')!;
    await addPurchase({
      productName: 'گوشت راسته',
      quantity: 12,
      unit: 'کیلوگرم',
      price: 8400000,
      purchaseDate: jalaliDateISO
    });

    const backup = await backupService.exportBackup();
    await purchaseRepository.clear();
    expect(await purchaseRepository.getAll()).toHaveLength(0);

    await backupService.restoreBackup(backup);
    const restored = await purchaseRepository.getAll();
    expect(restored).toHaveLength(1);
    expect(restored[0].purchaseDate).toBe('2026-11-03');
  });
});
