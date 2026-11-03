import type { BackupData, Purchase } from '../models/types';
import { parseNumericInput } from './formatters';

export function validatePurchaseInput(data: {
  productName: string;
  quantity: string | number;
  price: string | number;
  purchaseDate: string;
}): { isValid: boolean; error?: string; cleanData?: { quantity: number; price: number } } {
  if (!data.productName.trim()) {
    return { isValid: false, error: 'لطفاً نام محصول را وارد کنید.' };
  }

  const quantity = parseNumericInput(data.quantity);
  if (isNaN(quantity) || quantity <= 0) {
    return { isValid: false, error: 'مقدار باید عددی بزرگ‌تر از صفر باشد.' };
  }

  const price = parseNumericInput(data.price);
  if (isNaN(price) || price <= 0) {
    return { isValid: false, error: 'مبلغ خرید باید عددی بزرگ‌تر از صفر باشد.' };
  }

  if (!data.purchaseDate) {
    return { isValid: false, error: 'لطفاً تاریخ خرید را مشخص کنید.' };
  }

  return { isValid: true, cleanData: { quantity, price } };
}

export function validateBackupData(data: any): data is BackupData {
  if (!data || typeof data !== 'object') return false;
  if (typeof data.version !== 'number') return false;
  if (!Array.isArray(data.purchases)) return false;

  for (const item of data.purchases) {
    if (!item.id || !item.productName || typeof item.quantity !== 'number' || typeof item.totalAmount !== 'number') {
      return false;
    }
  }

  return true;
}
