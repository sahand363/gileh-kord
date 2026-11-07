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
  | 'employees'
  | 'timesheets'
  | 'revenue'
  | 'manager'
  | 'menu'
  | 'history_logs'
  | 'products'
  | 'suppliers'
  | 'inventory'
  | 'expenses'
  | 'reports'
  | 'settings'
  | 'backup';

export const PERSIAN_WEEKDAYS = [
  'شنبه',
  'یکشنبه',
  'دوشنبه',
  'سه‌شنبه',
  'چهارشنبه',
  'پنجشنبه',
  'جمعه'
] as const;

export type PersianWeekdayIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface ExpectedDaySchedule {
  enabled: boolean;
  startTime: string;
  endTime: string;
}

export type WeeklyExpectedSchedule = Record<PersianWeekdayIndex, ExpectedDaySchedule>;

export interface Employee {
  id: string;
  name: string;
  role: string;
  phone?: string;
  notes?: string;
  isActive: boolean;
  performanceCoefficient: number;
  expectedSchedule?: WeeklyExpectedSchedule;
  isDemo?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Purchase {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  unit: string;
  totalAmount: number;
  currency: 'IRT';
  purchaseDate: string;
  employeeId?: string;
  employeeNameSnapshot?: string;
  supplierId?: string;
  supplierName?: string;
  invoiceNumber?: string;
  notes?: string;
  isDemo?: boolean;
  createdAt: string;
  updatedAt: string;
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
  alertEnabled?: boolean;
  lastUpdated: string;
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
  expenseDate: string;
  notes?: string;
  isDemo?: boolean;
  createdAt: string;
}

export type RevenueRecordingMode = 'daily_total' | 'detailed';

export const REVENUE_CATEGORIES = [
  'فروش غذا (سالن)',
  'سفارش بیرون‌بر',
  'سفارش آنلاین',
  'فروش نوشیدنی و پیش‌غذا',
  'سایر درآمدها'
] as const;

export type RevenueCategory = (typeof REVENUE_CATEGORIES)[number] | string;

export type PaymentMethod = 'کارت‌خوان / بانکی' | 'نقدی' | 'آنلاین' | 'ترکیبی';

export interface RevenueItemEntry {
  id: string;
  category: RevenueCategory;
  description: string;
  quantity?: number;
  unitPrice?: number;
  amount: number;
  paymentMethod?: PaymentMethod;
  notes?: string;
  createdAt: string;
}

export interface RevenueDayRecord {
  id: string;
  date: string;
  mode: RevenueRecordingMode;
  dailyTotalAmount: number;
  cashAmount?: number;
  cardAmount?: number;
  onlineAmount?: number;
  notes?: string;
  entries: RevenueItemEntry[];
  isDemo?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TimesheetEditLog {
  editedAt: string;
  previousClockIn: string;
  previousClockOut: string;
  previousBreakMinutes: number;
  reason?: string;
}

export interface TimesheetEntry {
  id: string;
  employeeId: string;
  date: string;
  clockIn: string;
  clockOut: string;
  overnight: boolean;
  breakMinutes: number;
  netMinutes: number;
  notes?: string;
  editHistory?: TimesheetEditLog[];
  isDemo?: boolean;
  createdAt: string;
  updatedAt: string;
}

export const MENU_CATEGORIES = [
  'غذای اصلی و کباب‌ها',
  'خورشت‌های محلی گیلانی و کردی',
  'پیش‌غذا و مخلفات',
  'نوشیدنی‌ها',
  'دسر و سایر'
] as const;

export type MenuCategory = (typeof MENU_CATEGORIES)[number] | string;

export interface MenuItem {
  id: string;
  name: string;
  category: MenuCategory;
  price: number; // In Toman
  isAvailable: boolean;
  description?: string;
  isDemo?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SyncSnapshotMeta {
  id: string;
  timestamp: string;
  actor: string;
  actionSummary: string;
  counts: {
    purchases: number;
    revenues: number;
    employees: number;
    menuItems: number;
  };
}

export interface ManagerAuthRecord {
  key: 'manager_credentials';
  username: string;
  passwordHash: string;
  salt: string;
  createdAt: string;
  updatedAt: string;
}

export type ReportingCurrency = 'TOMAN' | 'RIAL';

export interface ApplicationSettings {
  restaurantName: string;
  branchName: string;
  serverAddress: string;
  defaultUnit: string;
  currency: 'IRT';
  reportingCurrency?: ReportingCurrency;
  backendSyncEnabled?: boolean;
  lastSelectedEmployeeId: string;
  globalRevenueCoefficient: number;
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
  employees?: Employee[];
  revenues?: RevenueDayRecord[];
  timesheets?: TimesheetEntry[];
  menuItems?: MenuItem[];
  settings: ApplicationSettings;
}

export interface PurchaseFilterCriteria {
  query?: string;
  dateFrom?: string;
  dateTo?: string;
  supplierName?: string;
  employeeId?: string;
  onlyReal?: boolean;
}

export interface PurchaseSummaryStats {
  count: number;
  total: number;
  average: number;
}
