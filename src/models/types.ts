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
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

export interface Product {
  id: string;
  name: string;
  normalizedName: string;
  lastUnit: string;
  lastPrice: number;
  lastPurchaseDate: string;
  totalPurchasesCount: number;
}

export interface Supplier {
  id: string;
  name: string;
  phone?: string;
  address?: string;
}

export interface ApplicationSettings {
  serverAddress: string;
  defaultUnit: string;
  currency: 'IRT';
  lastSyncAt: string | null;
}

export interface BackupData {
  version: number;
  exportedAt: string;
  purchases: Purchase[];
  products: Product[];
  settings: ApplicationSettings;
}

export interface PurchaseFilterCriteria {
  query?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface PurchaseSummaryStats {
  count: number;
  total: number;
  average: number;
}
