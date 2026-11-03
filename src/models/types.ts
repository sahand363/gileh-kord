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
  startTime: string; // HH:MM (e.g. "08:00")
  endTime: string;   // HH:MM (e.g. "17:00")
}

export type WeeklyExpectedSchedule = Record<PersianWeekdayIndex, ExpectedDaySchedule>;

export interface Employee {
  id: string;
  name: string;
  role: string;
  phone?: string;
  notes?: string;
  isActive: boolean;
  performanceCoefficient: number; // Default 1.0, prepared for future profit-sharing
  expectedSchedule?: WeeklyExpectedSchedule; // Optional per-weekday expected hours
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
  purchaseDate: string; // YYYY-MM-DD
  employeeId?: string; // Permanent employee ID reference
  employeeNameSnapshot?: string; // Historical fallback name if needed
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

/**
 * Keyed by `date` (YYYY-MM-DD) or unique `id` (one canonical record per date)
 * so daily_total and detailed entries never double-count the same day's income.
 */
export interface RevenueDayRecord {
  id: string;
  date: string; // YYYY-MM-DD
  mode: RevenueRecordingMode;
  dailyTotalAmount: number; // Used when mode === 'daily_total'
  cashAmount?: number;
  cardAmount?: number;
  onlineAmount?: number;
  notes?: string;
  entries: RevenueItemEntry[]; // Used when mode === 'detailed'
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
  date: string; // YYYY-MM-DD (Shift start date)
  clockIn: string; // HH:MM (24h)
  clockOut: string; // HH:MM (24h)
  overnight: boolean; // True if shift ends on the next calendar day
  breakMinutes: number;
  netMinutes: number; // Calculated working minutes excluding break
  notes?: string;
  editHistory?: TimesheetEditLog[];
  isDemo?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ManagerAuthRecord {
  key: 'manager_credentials';
  username: string;
  passwordHash: string;
  salt: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApplicationSettings {
  restaurantName: string;
  branchName: string;
  serverAddress: string;
  defaultUnit: string;
  currency: 'IRT';
  lastSelectedEmployeeId: string; // Sticky employee selection for purchase form
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
  settings: ApplicationSettings;
}

export interface PurchaseFilterCriteria {
  query?: string;
  dateFrom?: string;
  dateTo?: string;
  supplierName?: string;
  employeeId?: string; // '' = all, '__unassigned__' = no employee, or employee.id
  onlyReal?: boolean;
}

export interface PurchaseSummaryStats {
  count: number;
  total: number;
  average: number;
}
