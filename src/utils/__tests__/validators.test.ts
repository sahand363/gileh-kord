import { describe, it, expect } from 'vitest';
import { validatePurchaseInput, validateBackupPayload } from '../validators';

describe('validatePurchaseInput', () => {
  it('accepts valid Persian and English inputs including decimal quantities and large amounts', () => {
    const res = validatePurchaseInput({
      productName: '  برنج هاشمی  ',
      quantity: '۲٫۵',
      price: '۴٬۲۵۰٬۰۰۰',
      purchaseDate: '2026-11-03'
    });
    expect(res.isValid).toBe(true);
    expect(res.cleanData).toEqual({
      productName: 'برنج هاشمی',
      quantity: 2.5,
      price: 4250000,
      purchaseDate: '2026-11-03'
    });
  });

  it('rejects empty product names, zero/negative numbers, and invalid dates', () => {
    expect(
      validatePurchaseInput({
        productName: '   ',
        quantity: '5',
        price: '1000',
        purchaseDate: '2026-11-03'
      }).isValid
    ).toBe(false);

    expect(
      validatePurchaseInput({
        productName: 'روغن',
        quantity: '۰',
        price: '1000',
        purchaseDate: '2026-11-03'
      }).isValid
    ).toBe(false);

    expect(
      validatePurchaseInput({
        productName: 'روغن',
        quantity: '-2',
        price: '1000',
        purchaseDate: '2026-11-03'
      }).isValid
    ).toBe(false);

    expect(
      validatePurchaseInput({
        productName: 'روغن',
        quantity: '2',
        price: '0',
        purchaseDate: '2026-11-03'
      }).isValid
    ).toBe(false);

    expect(
      validatePurchaseInput({
        productName: 'روغن',
        quantity: '2',
        price: '100000',
        purchaseDate: '2026-02-30'
      }).isValid
    ).toBe(false);
  });
});

describe('validateBackupPayload', () => {
  it('validates a well-formed backup and derives consistent product records', () => {
    const payload = {
      version: 1,
      exportedAt: '2026-11-03T10:00:00.000Z',
      purchases: [
        {
          id: 'p1',
          productId: 'prod_1',
          productName: 'زعفران',
          quantity: 100,
          unit: 'گرم',
          totalAmount: 8500000,
          currency: 'IRT',
          purchaseDate: '2026-11-03',
          createdAt: '2026-11-03T10:00:00.000Z',
          updatedAt: '2026-11-03T10:00:00.000Z'
        }
      ],
      products: [],
      settings: {
        serverAddress: '',
        defaultUnit: 'کیلوگرم',
        currency: 'IRT',
        lastSyncAt: null
      }
    };

    const result = validateBackupPayload(payload);
    expect(result.isValid).toBe(true);
    expect(result.normalizedBackup?.products).toHaveLength(1);
    expect(result.normalizedBackup?.products[0].lastUnit).toBe('گرم');
    expect(result.normalizedBackup?.products[0].lastPrice).toBe(8500000);
  });

  it('rejects unsupported backup versions, duplicate purchase IDs, and negative amounts', () => {
    expect(validateBackupPayload({ version: 99, purchases: [] }).isValid).toBe(false);

    const duplicateIds = {
      version: 1,
      purchases: [
        {
          id: 'dup1',
          productName: 'مرغ',
          quantity: 5,
          unit: 'کیلوگرم',
          totalAmount: 500000,
          purchaseDate: '2026-11-03'
        },
        {
          id: 'dup1',
          productName: 'گوشت',
          quantity: 2,
          unit: 'کیلوگرم',
          totalAmount: 900000,
          purchaseDate: '2026-11-03'
        }
      ]
    };
    expect(validateBackupPayload(duplicateIds).isValid).toBe(false);

    const negativePrice = {
      version: 1,
      purchases: [
        {
          id: 'p1',
          productName: 'مرغ',
          quantity: 5,
          unit: 'کیلوگرم',
          totalAmount: -100,
          purchaseDate: '2026-11-03'
        }
      ]
    };
    expect(validateBackupPayload(negativePrice).isValid).toBe(false);
  });
});
