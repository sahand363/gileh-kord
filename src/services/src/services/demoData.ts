import type {
  Employee,
  Expense,
  InventoryItem,
  Product,
  Purchase,
  RevenueDayRecord,
  Supplier,
  TimesheetEntry
} from '../models/types';
import { getTodayISODate, normalizeProductKey } from '../utils/formatters';
import { createDefaultWeeklySchedule } from '../utils/timesheetUtils';

function daysAgoISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return getTodayISODate(d);
}

export function createInitialDemoDataset(): {
  employees: Employee[];
  purchases: Purchase[];
  products: Product[];
  suppliers: Supplier[];
  inventory: InventoryItem[];
  expenses: Expense[];
  revenues: RevenueDayRecord[];
  timesheets: TimesheetEntry[];
} {
  const today = getTodayISODate();
  const yesterday = daysAgoISO(1);
  const twoDaysAgo = daysAgoISO(2);
  const threeDaysAgo = daysAgoISO(3);
  const fourDaysAgo = daysAgoISO(4);
  const sixDaysAgo = daysAgoISO(6);
  const nowIso = new Date().toISOString();

  const standardSchedule = createDefaultWeeklySchedule(true);

  const employees: Employee[] = [
    {
      id: 'demo_emp_1',
      name: 'علی رضوانی',
      role: 'مسئول خرید',
      phone: '۰۹۱۱-۲۳۴۵۶۷۸',
      notes: 'مسئول خرید روزانه تره‌بار، برنج و اقلام پروتئینی',
      isActive: true,
      performanceCoefficient: 1.0,
      expectedSchedule: standardSchedule,
      isDemo: true,
      createdAt: nowIso,
      updatedAt: nowIso
    },
    {
      id: 'demo_emp_2',
      name: 'رضا کردستانی',
      role: 'سرآشپز',
      phone: '۰۹۱۸-۳۴۵۶۷۸۹',
      notes: 'مسئول کنترل کیفیت زعفران، ادویه و گوشت',
      isActive: true,
      performanceCoefficient: 1.2,
      expectedSchedule: standardSchedule,
      isDemo: true,
      createdAt: nowIso,
      updatedAt: nowIso
    },
    {
      id: 'demo_emp_3',
      name: 'محمد گیلانی',
      role: 'کمک‌آشپز',
      phone: '۰۹۱۲-۴۵۶۷۸۹۰',
      notes: 'شیفت آماده‌سازی صبح و عصر',
      isActive: true,
      performanceCoefficient: 0.9,
      expectedSchedule: standardSchedule,
      isDemo: true,
      createdAt: nowIso,
      updatedAt: nowIso
    },
    {
      id: 'demo_emp_4',
      name: 'مهدی صادقی',
      role: 'انباردار',
      phone: '۰۹۳۵-۵۶۷۸۹۰۱',
      notes: 'مسئول تحویل بار و ظروف بسته‌بندی',
      isActive: true,
      performanceCoefficient: 1.0,
      expectedSchedule: createDefaultWeeklySchedule(false),
      isDemo: true,
      createdAt: nowIso,
      updatedAt: nowIso
    }
  ];

  const purchases: Purchase[] = [
    {
      id: 'demo_p1',
      productId: 'demo_prod_1',
      productName: 'برنج هاشمی',
      quantity: 25,
      unit: 'کیلوگرم',
      totalAmount: 4250000,
      currency: 'IRT',
      purchaseDate: today,
      employeeId: 'demo_emp_1',
      employeeNameSnapshot: 'علی رضوانی',
      supplierName: 'برنج‌فروشی شمال',
      invoiceNumber: '۱۰۲۴',
      notes: 'کیسه ۲۵ کیلویی درجه یک گیلان',
      isDemo: true,
      createdAt: nowIso,
      updatedAt: nowIso
    },
    {
      id: 'demo_p2',
      productId: 'demo_prod_2',
      productName: 'روغن سرخ‌کردنی',
      quantity: 12,
      unit: 'لیتر',
      totalAmount: 1980000,
      currency: 'IRT',
      purchaseDate: today,
      employeeId: 'demo_emp_1',
      employeeNameSnapshot: 'علی رضوانی',
      supplierName: 'پخش مواد غذایی بهار',
      invoiceNumber: '۸۸۱',
      notes: '',
      isDemo: true,
      createdAt: nowIso,
      updatedAt: nowIso
    },
    {
      id: 'demo_p3',
      productId: 'demo_prod_3',
      productName: 'مرغ تازه',
      quantity: 18,
      unit: 'کیلوگرم',
      totalAmount: 3240000,
      currency: 'IRT',
      purchaseDate: yesterday,
      employeeId: 'demo_emp_1',
      employeeNameSnapshot: 'علی رضوانی',
      supplierName: 'پروتئینی مرکزی',
      invoiceNumber: '۷۳۱',
      notes: 'تحویل صبح',
      isDemo: true,
      createdAt: nowIso,
      updatedAt: nowIso
    },
    {
      id: 'demo_p4',
      productId: 'demo_prod_4',
      productName: 'گوجه فرنگی',
      quantity: 10,
      unit: 'کیلوگرم',
      totalAmount: 680000,
      currency: 'IRT',
      purchaseDate: yesterday,
      employeeId: 'demo_emp_3',
      employeeNameSnapshot: 'محمد گیلانی',
      supplierName: 'تره‌بار روز',
      invoiceNumber: '',
      notes: 'خرید فوری آشپزخانه',
      isDemo: true,
      createdAt: nowIso,
      updatedAt: nowIso
    },
    {
      id: 'demo_p5',
      productId: 'demo_prod_5',
      productName: 'زعفران',
      quantity: 100,
      unit: 'گرم',
      totalAmount: 8500000,
      currency: 'IRT',
      purchaseDate: threeDaysAgo,
      employeeId: 'demo_emp_2',
      employeeNameSnapshot: 'رضا کردستانی',
      supplierName: 'عطاری رضایی',
      invoiceNumber: '۵۲',
      notes: 'سرگل ممتاز',
      isDemo: true,
      createdAt: nowIso,
      updatedAt: nowIso
    },
    {
      id: 'demo_p6',
      productId: 'demo_prod_6',
      productName: 'ظرف بیرون‌بر',
      quantity: 200,
      unit: 'عدد',
      totalAmount: 1600000,
      currency: 'IRT',
      purchaseDate: fourDaysAgo,
      employeeId: 'demo_emp_4',
      employeeNameSnapshot: 'مهدی صادقی',
      supplierName: 'لوازم یکبارمصرف آریا',
      invoiceNumber: '۴۱۱',
      notes: 'ظرف سه خانه مایکروفر',
      isDemo: true,
      createdAt: nowIso,
      updatedAt: nowIso
    },
    {
      id: 'demo_p7',
      productId: 'demo_prod_1',
      productName: 'برنج هاشمی',
      quantity: 20,
      unit: 'کیلوگرم',
      totalAmount: 3380000,
      currency: 'IRT',
      purchaseDate: sixDaysAgo,
      // Intentionally without employeeId to demonstrate historical backward compatibility ("بدون ثبت مسئول خرید")
      supplierName: 'برنج‌فروشی شمال',
      invoiceNumber: '۹۹۱',
      notes: 'ثبت‌شده پیش از فعال‌سازی ماژول کارکنان',
      isDemo: true,
      createdAt: nowIso,
      updatedAt: nowIso
    }
  ];

  const products: Product[] = [
    {
      id: 'demo_prod_1',
      name: 'برنج هاشمی',
      normalizedName: normalizeProductKey('برنج هاشمی'),
      category: 'غلات و حبوبات',
      lastUnit: 'کیلوگرم',
      lastPrice: 4250000,
      lastPurchaseDate: today,
      totalPurchasesCount: 2,
      isDemo: true
    },
    {
      id: 'demo_prod_2',
      name: 'روغن سرخ‌کردنی',
      normalizedName: normalizeProductKey('روغن سرخ‌کردنی'),
      category: 'روغن و لبنیات',
      lastUnit: 'لیتر',
      lastPrice: 1980000,
      lastPurchaseDate: today,
      totalPurchasesCount: 1,
      isDemo: true
    },
    {
      id: 'demo_prod_3',
      name: 'مرغ تازه',
      normalizedName: normalizeProductKey('مرغ تازه'),
      category: 'پروتئینی',
      lastUnit: 'کیلوگرم',
      lastPrice: 3240000,
      lastPurchaseDate: yesterday,
      totalPurchasesCount: 1,
      isDemo: true
    },
    {
      id: 'demo_prod_4',
      name: 'گوجه فرنگی',
      normalizedName: normalizeProductKey('گوجه فرنگی'),
      category: 'سبزیجات و تره‌بار',
      lastUnit: 'کیلوگرم',
      lastPrice: 680000,
      lastPurchaseDate: yesterday,
      totalPurchasesCount: 1,
      isDemo: true
    },
    {
      id: 'demo_prod_5',
      name: 'زعفران',
      normalizedName: normalizeProductKey('زعفران'),
      category: 'ادویه و چاشنی',
      lastUnit: 'گرم',
      lastPrice: 8500000,
      lastPurchaseDate: threeDaysAgo,
      totalPurchasesCount: 1,
      isDemo: true
    },
    {
      id: 'demo_prod_6',
      name: 'ظرف بیرون‌بر',
      normalizedName: normalizeProductKey('ظرف بیرون‌بر'),
      category: 'بسته‌بندی',
      lastUnit: 'عدد',
      lastPrice: 1600000,
      lastPurchaseDate: fourDaysAgo,
      totalPurchasesCount: 1,
      isDemo: true
    }
  ];

  const suppliers: Supplier[] = [
    {
      id: 'demo_sup_1',
      name: 'برنج‌فروشی شمال',
      category: 'غلات و برنج ایرانی',
      phone: '۰۱۳-۳۳۲۴۵۶۷۸',
      city: 'رشت',
      notes: 'تأمین‌کننده اصلی برنج هاشمی و دودی',
      lastPurchaseDate: today,
      totalPurchasesAmount: 7630000,
      purchasesCount: 2,
      isDemo: true
    },
    {
      id: 'demo_sup_2',
      name: 'پخش مواد غذایی بهار',
      category: 'مواد غذایی خشک و روغن',
      phone: '۰۲۱-۵۵۶۶۷۷۸۸',
      city: 'تهران',
      notes: 'ارسال هفتگی سه‌شنبه‌ها',
      lastPurchaseDate: today,
      totalPurchasesAmount: 1980000,
      purchasesCount: 1,
      isDemo: true
    },
    {
      id: 'demo_sup_3',
      name: 'پروتئینی مرکزی',
      category: 'گوشت و مرغ تازه',
      phone: '۰۸۷-۳۳۲۸۹۱۰۱',
      city: 'سنندج',
      notes: 'تحویل روزانه ساعت ۷ صبح',
      lastPurchaseDate: yesterday,
      totalPurchasesAmount: 3240000,
      purchasesCount: 1,
      isDemo: true
    },
    {
      id: 'demo_sup_4',
      name: 'تره‌بار روز',
      category: 'میوه و سبزیجات تازه',
      phone: '۰۹۱۲-۳۴۵۶۷۸۹',
      city: 'تهران',
      notes: 'خرید نقدی روزانه',
      lastPurchaseDate: yesterday,
      totalPurchasesAmount: 680000,
      purchasesCount: 1,
      isDemo: true
    },
    {
      id: 'demo_sup_5',
      name: 'عطاری رضایی',
      category: 'زعفران، ادویه و سبزی معطر',
      phone: '۰۵۱-۳۲۲۱۴۴۵۵',
      city: 'مشهد',
      notes: 'تضمین کیفیت زعفران سرگل',
      lastPurchaseDate: threeDaysAgo,
      totalPurchasesAmount: 8500000,
      purchasesCount: 1,
      isDemo: true
    },
    {
      id: 'demo_sup_6',
      name: 'لوازم یکبارمصرف آریا',
      category: 'ظروف بیرون‌بر و بسته‌بندی',
      phone: '۰۲۱-۶۶۴۴۳۳۲۲',
      city: 'تهران',
      notes: 'چاپ لوگوی گیله‌کُرد روی ظروف',
      lastPurchaseDate: fourDaysAgo,
      totalPurchasesAmount: 1600000,
      purchasesCount: 1,
      isDemo: true
    }
  ];

  const inventory: InventoryItem[] = [
    {
      id: 'demo_inv_1',
      productName: 'برنج هاشمی',
      category: 'غلات و حبوبات',
      currentStock: 38,
      minStockThreshold: 20,
      unit: 'کیلوگرم',
      lastUpdated: today,
      isDemo: true
    },
    {
      id: 'demo_inv_2',
      productName: 'روغن سرخ‌کردنی',
      category: 'روغن و لبنیات',
      currentStock: 14,
      minStockThreshold: 10,
      unit: 'لیتر',
      lastUpdated: today,
      isDemo: true
    },
    {
      id: 'demo_inv_3',
      productName: 'مرغ تازه',
      category: 'پروتئینی',
      currentStock: 6,
      minStockThreshold: 12,
      unit: 'کیلوگرم',
      lastUpdated: yesterday,
      isDemo: true
    },
    {
      id: 'demo_inv_4',
      productName: 'گوجه فرنگی',
      category: 'سبزیجات و تره‌بار',
      currentStock: 4,
      minStockThreshold: 8,
      unit: 'کیلوگرم',
      lastUpdated: yesterday,
      isDemo: true
    },
    {
      id: 'demo_inv_5',
      productName: 'زعفران',
      category: 'ادویه و چاشنی',
      currentStock: 85,
      minStockThreshold: 30,
      unit: 'گرم',
      lastUpdated: threeDaysAgo,
      isDemo: true
    },
    {
      id: 'demo_inv_6',
      productName: 'ظرف بیرون‌بر',
      category: 'بسته‌بندی',
      currentStock: 65,
      minStockThreshold: 100,
      unit: 'عدد',
      lastUpdated: fourDaysAgo,
      isDemo: true
    }
  ];

  const expenses: Expense[] = [
    {
      id: 'demo_exp_1',
      title: 'کرایه حمل بار برنج و تره‌بار',
      category: 'حمل و نقل',
      amount: 450000,
      expenseDate: today,
      notes: 'وانت بار خطی',
      isDemo: true,
      createdAt: nowIso
    },
    {
      id: 'demo_exp_2',
      title: 'سرویس هواکش و هود آشپزخانه',
      category: 'تعمیر و نگهداری',
      amount: 1200000,
      expenseDate: yesterday,
      notes: 'تعویض تسمه و شست‌وشوی فیلتر',
      isDemo: true,
      createdAt: nowIso
    },
    {
      id: 'demo_exp_3',
      title: 'قبض گاز و برق ماهانه آشپزخانه',
      category: 'اجاره و قبوض',
      amount: 2850000,
      expenseDate: threeDaysAgo,
      notes: 'شناسه قبض پرداخت‌شده',
      isDemo: true,
      createdAt: nowIso
    },
    {
      id: 'demo_exp_4',
      title: 'خرید مواد شوینده و ضدعفونی‌کننده سالن',
      category: 'بسته‌بندی و مصرفی',
      amount: 620000,
      expenseDate: fourDaysAgo,
      notes: '',
      isDemo: true,
      createdAt: nowIso
    }
  ];

  const revenues: RevenueDayRecord[] = [
    {
      id: `rev_${today}`,
      date: today,
      mode: 'daily_total',
      dailyTotalAmount: 18500000,
      cardAmount: 14200000,
      onlineAmount: 3500000,
      cashAmount: 800000,
      notes: 'فروش ناهار و شام روز جاری',
      entries: [],
      isDemo: true,
      createdAt: nowIso,
      updatedAt: nowIso
    },
    {
      id: `rev_${yesterday}`,
      date: yesterday,
      mode: 'detailed',
      dailyTotalAmount: 21400000,
      notes: 'ثبت به صورت ریز تراکنش‌های فروش',
      entries: [
        {
          id: 'demo_rev_item_1',
          category: 'فروش غذا (سالن)',
          description: 'فروش چلوکباب و خورشت‌های محلی سالن',
          quantity: 48,
          unitPrice: 300000,
          amount: 14400000,
          paymentMethod: 'کارت‌خوان / بانکی',
          createdAt: nowIso
        },
        {
          id: 'demo_rev_item_2',
          category: 'سفارش آنلاین',
          description: 'سفارش‌های پلتفرم آنلاین',
          quantity: 18,
          unitPrice: 280000,
          amount: 5040000,
          paymentMethod: 'آنلاین',
          createdAt: nowIso
        },
        {
          id: 'demo_rev_item_3',
          category: 'فروش نوشیدنی و پیش‌غذا',
          description: 'دوغ محلی، زیتون‌پرورده و ماست بورانی',
          amount: 1960000,
          paymentMethod: 'ترکیبی',
          createdAt: nowIso
        }
      ],
      isDemo: true,
      createdAt: nowIso,
      updatedAt: nowIso
    },
    {
      id: `rev_${twoDaysAgo}`,
      date: twoDaysAgo,
      mode: 'daily_total',
      dailyTotalAmount: 16900000,
      notes: 'بستن صندوق شبانه',
      entries: [],
      isDemo: true,
      createdAt: nowIso,
      updatedAt: nowIso
    }
  ];

  const timesheets: TimesheetEntry[] = [
    {
      id: 'demo_ts_1',
      employeeId: 'demo_emp_1',
      date: today,
      clockIn: '08:00',
      clockOut: '17:30',
      overnight: false,
      breakMinutes: 60,
      netMinutes: 510, // 8h 30m
      notes: 'خرید صبحگاهی تره‌بار و تحویل به انبار',
      isDemo: true,
      createdAt: nowIso,
      updatedAt: nowIso
    },
    {
      id: 'demo_ts_2',
      employeeId: 'demo_emp_2',
      date: today,
      clockIn: '08:15',
      clockOut: '18:00',
      overnight: false,
      breakMinutes: 45,
      netMinutes: 540, // 9h
      notes: 'آماده‌سازی منوی ظهر و شب',
      isDemo: true,
      createdAt: nowIso,
      updatedAt: nowIso
    },
    {
      id: 'demo_ts_3',
      employeeId: 'demo_emp_3',
      date: yesterday,
      clockIn: '16:00',
      clockOut: '00:30',
      overnight: true,
      breakMinutes: 30,
      netMinutes: 480, // 8h overnight shift
      notes: 'شیفت عصر و بستن آشپزخانه پس از نیمه‌شب',
      isDemo: true,
      createdAt: nowIso,
      updatedAt: nowIso
    },
    {
      id: 'demo_ts_4',
      employeeId: 'demo_emp_1',
      date: yesterday,
      clockIn: '08:00',
      clockOut: '17:00',
      overnight: false,
      breakMinutes: 60,
      netMinutes: 480, // 8h
      notes: '',
      isDemo: true,
      createdAt: nowIso,
      updatedAt: nowIso
    }
  ];

  return {
    employees,
    purchases,
    products,
    suppliers,
    inventory,
    expenses,
    revenues,
    timesheets
  };
}
