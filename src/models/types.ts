export const MEASUREMENT_UNITS = [
  'کیلوگرم',
  'گرم',
  'لیتر',
  'عدد',
  'بسته',
  'کارتن',
  'کیسه',
  'دستگاه'
] as const;

export type MeasurementUnit = (typeof MEASUREMENT_UNITS)[number] | string;

export type AppPage =
  | 'dashboard'
  | 'entry'
  | 'history'
  | 'products'
  | 'suppliers'
  | 'inventory'
  | 'expenses'
  | 'reports'
  | 'settings'
  | 'backup';

export interface Purchase {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  unit: string;
  totalAmount: number;
  currency: 'IRT';
  purchaseDate: string; // YYYY-MM-DD
  supplierId?: string;
  supplierName?: string;
  invoiceNumber?: string;
  notes?: string;
  isDemo?: boolean;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

export interface Product {
  id: string;
  name: string;
  normalizedName: string;
  category?: string;
  lastUnit: string;
  lastPrice: number;
  lastPurchaseDate: string;
  totalPurchasesCount: number;
  isDemo?: boolean;
}

export interface Supplier {
  id: string;
  name: string;
  category: string;
  phone: string;
  city: string;
  notes?: string;
  lastPurchaseDate?: string;
  totalPurchasesAmount: number;
  purchasesCount: number;
  isDemo?: boolean;
}

export interface InventoryItem {
  id: string;
  productName: string;
  category: string;
  currentStock: number;
  minStockThreshold: number;
  unit: string;
  lastUpdated: string; // YYYY-MM-DD
  isDemo?: boolean;
}

export type ExpenseCategory =
  | 'اجاره و قبوض'
  | 'حقوق و دستمزد'
  | 'تعمیر و نگهداری'
  | 'حمل و نقل'
  | 'بسته‌بندی و مصرفی'
  | 'سایر هزینه‌ها';

export interface Expense {
  id: string;
  title: string;
  category: ExpenseCategory | string;
  amount: number;
  expenseDate: string; // YYYY-MM-DD
  notes?: string;
  isDemo?: boolean;
  createdAt: string;
}

export interface ApplicationSettings {
  restaurantName: string;
  branchName: string;
  serverAddress: string;
  defaultUnit: string;
  currency: 'IRT';
  showDemoBadges: boolean;
  demoSeedInitialized: boolean;
  lastSyncAt: string | null;
}

export interface BackupData {
  version: number;
  exportedAt: string;
  purchases: Purchase[];
  products: Product[];
  suppliers?: Supplier[];
  inventory?: InventoryItem[];
  expenses?: Expense[];
  settings: ApplicationSettings;
}

export interface PurchaseFilterCriteria {
  query?: string;
  dateFrom?: string;
  dateTo?: string;
  supplierName?: string;
  onlyReal?: boolean;
}

export interface PurchaseSummaryStats {
  count: number;
  total: number;
  average: number;
}
