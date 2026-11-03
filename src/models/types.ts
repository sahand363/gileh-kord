export interface Purchase {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  unit: string;
  totalAmount: number;
  currency: 'IRT'; // Iranian Toman
  purchaseDate: string; // ISO format: YYYY-MM-DD
  supplierId?: string;
  supplierName?: string;
  invoiceNumber?: string;
  notes?: string;
  createdAt: string; // ISO 8601 string
  updatedAt: string; // ISO 8601 string
}

export interface Product {
  id: string;
  name: string;
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
  currency: string;
  lastSyncAt: string | null;
}

export interface BackupData {
  version: number;
  exportedAt: string;
  purchases: Purchase[];
  products: Product[];
  settings: ApplicationSettings;
}
