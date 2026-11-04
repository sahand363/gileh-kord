import type {
  ApplicationSettings,
  BackupData,
  Employee,
  Expense,
  InventoryItem,
  Product,
  Purchase,
  RevenueDayRecord,
  Supplier,
  TimesheetEntry
} from '../models/types';
import {
  isValidISODate,
  MAX_SAFE_AMOUNT,
  MAX_SAFE_QUANTITY,
  normalizeProductKey,
  parseNumericInput
} from './formatters';
import { DEFAULT_SETTINGS } from '../services/repositories/SettingsRepository';
import { generateId } from './uuid';

export interface PurchaseValidationResult {
  isValid: boolean;
  error?: string;
  cleanData?: {
    productName: string;
    quantity: number;
    price: number;
    purchaseDate: string;
  };
}

export function validatePurchaseInput(data: {
  productName: string;
  quantity: string | number;
  price: string | number;
  purchaseDate: string;
}): PurchaseValidationResult {
  const cleanName = String(data.productName ?? '').trim().replace(/\s+/g, ' ');
  if (!cleanName) {
    return { isValid: false, error: 'لطفاً نام محصول را وارد کنید.' };
  }

  const quantity = parseNumericInput(data.quantity);
  if (isNaN(quantity) || quantity <= 0) {
    return { isValid: false, error: 'مقدار باید عددی بزرگ‌تر از صفر باشد.' };
  }
  if (quantity > MAX_SAFE_QUANTITY) {
    return { isValid: false, error: 'مقدار واردشده خارج از محدوده مجاز است.' };
  }

  const rawPrice = parseNumericInput(data.price);
  if (isNaN(rawPrice) || rawPrice <= 0) {
    return { isValid: false, error: 'مبلغ خرید باید عددی بزرگ‌تر از صفر باشد.' };
  }
  if (rawPrice > MAX_SAFE_AMOUNT) {
    return { isValid: false, error: 'مبلغ واردشده بیش از حد مجاز است.' };
  }
  const price = Math.round(rawPrice);

  if (!data.purchaseDate || !isValidISODate(data.purchaseDate)) {
    return { isValid: false, error: 'لطفاً تاریخ خرید معتبری را مشخص کنید.' };
  }

  return {
    isValid: true,
    cleanData: {
      productName: cleanName,
      quantity,
      price,
      purchaseDate: data.purchaseDate
    }
  };
}

export interface BackupValidationResult {
  isValid: boolean;
  error?: string;
  normalizedBackup?: BackupData;
}

const SUPPORTED_BACKUP_VERSIONS = [1, 2, 3];

export function deriveProductsFromPurchases(
  purchases: Purchase[],
  existingProducts: Product[] = []
): Product[] {
  const existingMap = new Map<string, Product>();
  for (const prod of existingProducts) {
    if (prod && typeof prod.name === 'string' && prod.name.trim()) {
      const key = normalizeProductKey(prod.name);
      if (!existingMap.has(key)) {
        existingMap.set(key, {
          id: String(prod.id || generateId('prod')),
          name: prod.name.trim(),
          normalizedName: key,
          category: prod.category || 'عمومی',
          lastUnit: String(prod.lastUnit || 'کیلوگرم'),
          lastPrice: Number(prod.lastPrice) > 0 ? Math.round(Number(prod.lastPrice)) : 0,
          lastPurchaseDate: isValidISODate(prod.lastPurchaseDate)
            ? prod.lastPurchaseDate
            : '1970-01-01',
          totalPurchasesCount: Math.max(
            0,
            Math.trunc(Number(prod.totalPurchasesCount) || 0)
          ),
          isDemo: Boolean(prod.isDemo)
        });
      }
    }
  }

  const sorted = [...purchases].sort(
    (a, b) =>
      a.purchaseDate.localeCompare(b.purchaseDate) ||
      a.createdAt.localeCompare(b.createdAt)
  );

  const countByProduct = new Map<string, number>();

  for (const p of sorted) {
    const key = normalizeProductKey(p.productName);
    const prevCount = countByProduct.get(key) || 0;
    countByProduct.set(key, prevCount + 1);

    const existing = existingMap.get(key);
    if (!existing) {
      existingMap.set(key, {
        id: p.productId || generateId('prod'),
        name: p.productName.trim(),
        normalizedName: key,
        category: 'عمومی',
        lastUnit: p.unit,
        lastPrice: p.totalAmount,
        lastPurchaseDate: p.purchaseDate,
        totalPurchasesCount: prevCount + 1,
        isDemo: Boolean(p.isDemo)
      });
    } else {
      const isNewerOrEqual = p.purchaseDate >= existing.lastPurchaseDate;
      existingMap.set(key, {
        ...existing,
        lastUnit: isNewerOrEqual ? p.unit : existing.lastUnit,
        lastPrice: isNewerOrEqual ? p.totalAmount : existing.lastPrice,
        lastPurchaseDate: isNewerOrEqual ? p.purchaseDate : existing.lastPurchaseDate,
        totalPurchasesCount: prevCount + 1,
        isDemo: existing.isDemo && Boolean(p.isDemo)
      });
    }
  }

  return Array.from(existingMap.values());
}

export function validateBackupPayload(raw: unknown): BackupValidationResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { isValid: false, error: 'ساختار فایل پشتیبان نامعتبر است.' };
  }

  const data = raw as Record<string, unknown>;

  if (
    typeof data.version !== 'number' ||
    !SUPPORTED_BACKUP_VERSIONS.includes(data.version)
  ) {
    return {
      isValid: false,
      error: 'نسخه فایل پشتیبان پشتیبانی نمی‌شود یا نامعتبر است.'
    };
  }

  if (!Array.isArray(data.purchases)) {
    return { isValid: false, error: 'فهرست خریدها در فایل پشتیبان یافت نشد.' };
  }

  const seenPurchaseIds = new Set<string>();
  const validatedPurchases: Purchase[] = [];

  for (let i = 0; i < data.purchases.length; i++) {
    const item = data.purchases[i] as Record<string, unknown>;
    if (!item || typeof item !== 'object') {
      return { isValid: false, error: `ردیف خرید شماره ${i + 1} معتبر نیست.` };
    }

    const id = typeof item.id === 'string' ? item.id.trim() : '';
    if (!id) {
      return { isValid: false, error: `شناسه خرید در ردیف ${i + 1} وجود ندارد.` };
    }
    if (seenPurchaseIds.has(id)) {
      return {
        isValid: false,
        error: `شناسه تکراری (${id}) در فایل پشتیبان یافت شد.`
      };
    }
    seenPurchaseIds.add(id);

    const productName =
      typeof item.productName === 'string' ? item.productName.trim() : '';
    if (!productName) {
      return { isValid: false, error: `نام محصول در ردیف ${i + 1} خالی است.` };
    }

    const quantity = Number(item.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > MAX_SAFE_QUANTITY) {
      return { isValid: false, error: `مقدار خرید در ردیف ${i + 1} نامعتبر است.` };
    }

    const rawAmount =
      item.totalAmount !== undefined ? Number(item.totalAmount) : Number(item.price);
    if (!Number.isFinite(rawAmount) || rawAmount <= 0 || rawAmount > MAX_SAFE_AMOUNT) {
      return { isValid: false, error: `مبلغ خرید در ردیف ${i + 1} نامعتبر است.` };
    }

    const purchaseDate =
      typeof item.purchaseDate === 'string'
        ? item.purchaseDate
        : typeof item.date === 'string'
          ? item.date
          : '';
    if (!isValidISODate(purchaseDate)) {
      return { isValid: false, error: `تاریخ خرید در ردیف ${i + 1} نامعتبر است.` };
    }

    const unit =
      typeof item.unit === 'string' && item.unit.trim()
        ? item.unit.trim()
        : 'کیلوگرم';

    const nowIso = new Date().toISOString();
    const createdAt =
      typeof item.createdAt === 'string' && item.createdAt ? item.createdAt : nowIso;
    const updatedAt =
      typeof item.updatedAt === 'string' && item.updatedAt ? item.updatedAt : createdAt;

    validatedPurchases.push({
      id,
      productId:
        typeof item.productId === 'string' && item.productId.trim()
          ? item.productId.trim()
          : `prod_${normalizeProductKey(productName)}`,
      productName,
      quantity,
      unit,
      totalAmount: Math.round(rawAmount),
      currency: 'IRT',
      purchaseDate,
      employeeId:
        typeof item.employeeId === 'string' && item.employeeId.trim()
          ? item.employeeId.trim()
          : undefined,
      employeeNameSnapshot:
        typeof item.employeeNameSnapshot === 'string' && item.employeeNameSnapshot.trim()
          ? item.employeeNameSnapshot.trim()
          : undefined,
      supplierName:
        typeof item.supplierName === 'string' && item.supplierName.trim()
          ? item.supplierName.trim()
          : typeof item.supplier === 'string' && item.supplier.trim()
            ? item.supplier.trim()
            : undefined,
      invoiceNumber:
        typeof item.invoiceNumber === 'string' && item.invoiceNumber.trim()
          ? item.invoiceNumber.trim()
          : typeof item.invoice === 'string' && item.invoice.trim()
            ? item.invoice.trim()
            : undefined,
      notes:
        typeof item.notes === 'string' && item.notes.trim()
          ? item.notes.trim()
          : undefined,
      isDemo: Boolean(item.isDemo),
      createdAt,
      updatedAt
    });
  }

  const rawProducts = Array.isArray(data.products) ? (data.products as Product[]) : [];
  const reconciledProducts = deriveProductsFromPurchases(validatedPurchases, rawProducts);

  const productByKey = new Map<string, Product>(
    reconciledProducts.map((p) => [p.normalizedName, p])
  );
  for (const purchase of validatedPurchases) {
    const matched = productByKey.get(normalizeProductKey(purchase.productName));
    if (matched) {
      purchase.productId = matched.id;
    }
  }

  const validatedSuppliers: Supplier[] = Array.isArray(data.suppliers)
    ? (data.suppliers as Supplier[]).filter(
        (s) => s && typeof s.id === 'string' && typeof s.name === 'string'
      )
    : [];

  const validatedInventory: InventoryItem[] = Array.isArray(data.inventory)
    ? (data.inventory as InventoryItem[]).filter(
        (inv) =>
          inv && typeof inv.id === 'string' && typeof inv.productName === 'string'
      )
    : [];

  const validatedExpenses: Expense[] = Array.isArray(data.expenses)
    ? (data.expenses as Expense[]).filter(
        (exp) =>
          exp &&
          typeof exp.id === 'string' &&
          typeof exp.title === 'string' &&
          Number(exp.amount) > 0
      )
    : [];

  const validatedEmployees: Employee[] = Array.isArray(data.employees)
    ? (data.employees as Employee[])
        .filter((e) => e && typeof e.id === 'string' && typeof e.name === 'string' && e.name.trim())
        .map((e) => ({
          ...e,
          name: e.name.trim(),
          role: typeof e.role === 'string' && e.role.trim() ? e.role.trim() : 'کارمند',
          isActive: e.isActive !== false,
          performanceCoefficient:
            Number.isFinite(Number(e.performanceCoefficient)) &&
            Number(e.performanceCoefficient) > 0
              ? Number(e.performanceCoefficient)
              : 1.0,
          createdAt: e.createdAt || new Date().toISOString(),
          updatedAt: e.updatedAt || new Date().toISOString()
        }))
    : [];

  const validatedRevenues: RevenueDayRecord[] = Array.isArray(data.revenues)
    ? (data.revenues as RevenueDayRecord[]).filter(
        (r) =>
          r &&
          typeof r.id === 'string' &&
          typeof r.date === 'string' &&
          isValidISODate(r.date) &&
          (r.mode === 'daily_total' || r.mode === 'detailed')
      )
    : [];

  const validatedTimesheets: TimesheetEntry[] = Array.isArray(data.timesheets)
    ? (data.timesheets as TimesheetEntry[]).filter(
        (t) =>
          t &&
          typeof t.id === 'string' &&
          typeof t.employeeId === 'string' &&
          typeof t.date === 'string' &&
          isValidISODate(t.date) &&
          typeof t.clockIn === 'string' &&
          typeof t.clockOut === 'string' &&
          Number(t.netMinutes) > 0
      )
    : [];

  const rawSettings =
    data.settings && typeof data.settings === 'object'
      ? (data.settings as Partial<ApplicationSettings>)
      : {};

  const parsedGlobalCoeff = Number(rawSettings.globalRevenueCoefficient);

  const validatedSettings: ApplicationSettings = {
    ...DEFAULT_SETTINGS,
    ...rawSettings,
    defaultUnit:
      typeof rawSettings.defaultUnit === 'string' && rawSettings.defaultUnit.trim()
        ? rawSettings.defaultUnit.trim()
        : 'کیلوگرم',
    lastSelectedEmployeeId:
      typeof rawSettings.lastSelectedEmployeeId === 'string'
        ? rawSettings.lastSelectedEmployeeId
        : '',
    globalRevenueCoefficient:
      Number.isFinite(parsedGlobalCoeff) &&
      parsedGlobalCoeff > 0 &&
      parsedGlobalCoeff <= 10
        ? parsedGlobalCoeff
        : DEFAULT_SETTINGS.globalRevenueCoefficient,
    currency: 'IRT',
    demoSeedInitialized: true
  };

  return {
    isValid: true,
    normalizedBackup: {
      version: 3,
      exportedAt:
        typeof data.exportedAt === 'string'
          ? data.exportedAt
          : new Date().toISOString(),
      purchases: validatedPurchases,
      products: reconciledProducts,
      suppliers: validatedSuppliers,
      inventory: validatedInventory,
      expenses: validatedExpenses,
      employees: validatedEmployees,
      revenues: validatedRevenues,
      timesheets: validatedTimesheets,
      settings: validatedSettings
    }
  };
}

export function validateBackupData(data: unknown): data is BackupData {
  return validateBackupPayload(data).isValid;
}
