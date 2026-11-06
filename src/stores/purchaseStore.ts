import { writable, derived, get } from 'svelte/store';
import type {
  ApplicationSettings,
  Employee,
  Expense,
  InventoryItem,
  PaymentMethod,
  Product,
  Purchase,
  RevenueCategory,
  RevenueDayRecord,
  RevenueItemEntry,
  RevenueRecordingMode,
  Supplier,
  TimesheetEditLog,
  TimesheetEntry,
  WeeklyExpectedSchedule
} from '../models/types';
import { purchaseRepository } from '../services/repositories/PurchaseRepository';
import { productRepository } from '../services/repositories/ProductRepository';
import {
  DEFAULT_SETTINGS,
  settingsRepository,
  SETTINGS_KEY
} from '../services/repositories/SettingsRepository';
import { ALL_STORES, dbClient, requestToPromise } from '../services/db';
import { createInitialDemoDataset } from '../services/demoData';
import { getTodayISODate, normalizeProductKey } from '../utils/formatters';
import {
  buildPublicRevenueView,
  calculateExpensesTotal,
  calculatePurchaseStats,
  getLowStockItems,
  sortPurchasesDescending
} from '../utils/calculations';
import {
  calculateShiftDuration,
  createDefaultWeeklySchedule
} from '../utils/timesheetUtils';
import { generateId } from '../utils/uuid';
import { managerAuthService } from '../services/ManagerAuthService';

export const purchases = writable<Purchase[]>([]);
export const products = writable<Product[]>([]);
export const suppliers = writable<Supplier[]>([]);
export const inventory = writable<InventoryItem[]>([]);
export const expenses = writable<Expense[]>([]);
export const employees = writable<Employee[]>([]);
export const revenues = writable<RevenueDayRecord[]>([]);
export const timesheets = writable<TimesheetEntry[]>([]);
export const appSettings = writable<ApplicationSettings>({ ...DEFAULT_SETTINGS });
export const isLoading = writable<boolean>(false);
export const dbError = writable<string | null>(null);

export const activeEmployees = derived(employees, ($employees) =>
  $employees.filter((e) => e.isActive)
);

export const employeeByIdMap = derived(employees, ($employees) => {
  const map = new Map<string, Employee>();
  for (const emp of $employees) {
    map.set(emp.id, emp);
  }
  return map;
});

export function resolvePurchaseEmployeeName(
  purchase: Purchase,
  empMap: Map<string, Employee>
): string {
  if (purchase.employeeId) {
    const found = empMap.get(purchase.employeeId);
    if (found) return found.name;
    if (purchase.employeeNameSnapshot) return purchase.employeeNameSnapshot;
  }
  return 'بدون ثبت مسئول خرید';
}

async function readStoreAll<T>(storeName: string): Promise<T[]> {
  return dbClient.executeTransaction(storeName, 'readonly', async (stores) => {
    const res = await requestToPromise(stores[storeName].getAll());
    return (res as T[]) || [];
  });
}

export async function loadPurchases(autoSeedDemoIfFirstRun = false): Promise<void> {
  isLoading.set(true);
  dbError.set(null);
  try {
    await managerAuthService.checkInitialized();
    const settings = await settingsRepository.getSettings();
    const [
      purchasesList,
      productsList,
      suppliersList,
      inventoryList,
      expensesList,
      employeesList,
      revenuesList,
      timesheetsList
    ] = await Promise.all([
      purchaseRepository.getAll(),
      productRepository.getAll(),
      readStoreAll<Supplier>('suppliers'),
      readStoreAll<InventoryItem>('inventory'),
      readStoreAll<Expense>('expenses'),
      readStoreAll<Employee>('employees'),
      readStoreAll<RevenueDayRecord>('revenues'),
      readStoreAll<TimesheetEntry>('timesheets')
    ]);

    if (
      autoSeedDemoIfFirstRun &&
      !settings.demoSeedInitialized &&
      purchasesList.length === 0 &&
      employeesList.length === 0
    ) {
      await loadDemoDataset();
      return;
    }

    if (!settings.lastSelectedEmployeeId && employeesList.length > 0) {
      const firstActive = employeesList.find((e) => e.isActive) || employeesList[0];
      settings.lastSelectedEmployeeId = firstActive.id;
      await settingsRepository.saveSettings({
        lastSelectedEmployeeId: firstActive.id
      });
    }

    purchases.set(purchasesList);
    products.set(productsList);
    suppliers.set(suppliersList);
    inventory.set(inventoryList);
    expenses.set(
      expensesList.sort((a, b) => b.expenseDate.localeCompare(a.expenseDate))
    );
    employees.set(
      employeesList.sort((a, b) => Number(b.isActive) - Number(a.isActive))
    );
    revenues.set(revenuesList.sort((a, b) => b.date.localeCompare(a.date)));
    timesheets.set(
      timesheetsList.sort(
        (a, b) =>
          b.date.localeCompare(a.date) || b.clockIn.localeCompare(a.clockIn)
      )
    );
    appSettings.set(settings);
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : 'خطا در بارگذاری اطلاعات از پایگاه داده محلی.';
    dbError.set(message);
  } finally {
    isLoading.set(false);
  }
}

export async function loadDemoDataset(): Promise<void> {
  const demo = createInitialDemoDataset();
  const currentSettings = await settingsRepository.getSettings();
  const updatedSettings: ApplicationSettings = {
    ...currentSettings,
    lastSelectedEmployeeId:
      currentSettings.lastSelectedEmployeeId || demo.employees[0].id,
    demoSeedInitialized: true
  };

  await dbClient.executeTransaction(
    [...ALL_STORES],
    'readwrite',
    async (stores) => {
      for (const item of demo.employees) {
        await requestToPromise(stores['employees'].put(item));
      }
      for (const item of demo.purchases) {
        await requestToPromise(stores['purchases'].put(item));
      }
      for (const item of demo.products) {
        await requestToPromise(stores['products'].put(item));
      }
      for (const item of demo.suppliers) {
        await requestToPromise(stores['suppliers'].put(item));
      }
      for (const item of demo.inventory) {
        await requestToPromise(stores['inventory'].put(item));
      }
      for (const item of demo.expenses) {
        await requestToPromise(stores['expenses'].put(item));
      }
      for (const item of demo.revenues) {
        await requestToPromise(stores['revenues'].put(item));
      }
      for (const item of demo.timesheets) {
        await requestToPromise(stores['timesheets'].put(item));
      }
      await requestToPromise(
        stores['settings'].put({ key: SETTINGS_KEY, value: updatedSettings })
      );
    }
  );

  await loadPurchases(false);
}

export async function clearDemoDataset(): Promise<void> {
  const currentSettings = await settingsRepository.getSettings();
  const isStickyDemo = currentSettings.lastSelectedEmployeeId.startsWith('demo_');
  const updatedSettings: ApplicationSettings = {
    ...currentSettings,
    lastSelectedEmployeeId: isStickyDemo ? '' : currentSettings.lastSelectedEmployeeId,
    demoSeedInitialized: true
  };

  await dbClient.executeTransaction(
    [...ALL_STORES],
    'readwrite',
    async (stores) => {
      const storeNames = [
        'purchases',
        'products',
        'suppliers',
        'inventory',
        'expenses',
        'employees',
        'revenues',
        'timesheets'
      ] as const;

      for (const name of storeNames) {
        const all = (await requestToPromise(stores[name].getAll())) as Array<{
          id: string;
          isDemo?: boolean;
        }>;
        for (const record of all) {
          if (record.isDemo) {
            await requestToPromise(stores[name].delete(record.id));
          }
        }
      }

      await requestToPromise(
        stores['settings'].put({ key: SETTINGS_KEY, value: updatedSettings })
      );
    }
  );

  await loadPurchases(false);
}

export async function setStickyEmployeeId(employeeId: string): Promise<void> {
  const saved = await settingsRepository.saveSettings({
    lastSelectedEmployeeId: employeeId
  });
  appSettings.set(saved);
}

export async function updateGlobalRevenueCoefficient(
  newCoefficient: number
): Promise<ApplicationSettings> {
  if (!Number.isFinite(newCoefficient) || newCoefficient <= 0 || newCoefficient > 10) {
    throw new Error('ضریب باید عددی مثبت و معتبر (مثلاً ۰.۶) باشد.');
  }
  const cleanCoeff = Number(newCoefficient.toFixed(4));
  const saved = await settingsRepository.saveSettings({
    globalRevenueCoefficient: cleanCoeff
  });
  appSettings.set(saved);
  return saved;
}

export async function addEmployee(input: {
  name: string;
  role?: string;
  phone?: string;
  notes?: string;
  isActive?: boolean;
  performanceCoefficient?: number;
  expectedSchedule?: WeeklyExpectedSchedule;
}): Promise<Employee> {
  const cleanName = input.name.trim();
  if (!cleanName) {
    throw new Error('نام کارمند الزامی است.');
  }

  const coeff = Number(input.performanceCoefficient);
  const validCoeff = Number.isFinite(coeff) && coeff > 0 ? Number(coeff.toFixed(2)) : 0.6;
  const now = new Date().toISOString();

  const emp: Employee = {
    id: generateId('emp'),
    name: cleanName,
    role: input.role?.trim() || 'کارمند',
    phone: input.phone?.trim() || undefined,
    notes: input.notes?.trim() || undefined,
    isActive: input.isActive !== false,
    performanceCoefficient: validCoeff,
    expectedSchedule: input.expectedSchedule || createDefaultWeeklySchedule(false),
    isDemo: false,
    createdAt: now,
    updatedAt: now
  };

  await dbClient.executeTransaction('employees', 'readwrite', async (stores) => {
    await requestToPromise(stores['employees'].put(emp));
  });

  const currentSettings = await settingsRepository.getSettings();
  if (!currentSettings.lastSelectedEmployeeId && emp.isActive) {
    await setStickyEmployeeId(emp.id);
  }

  await loadPurchases(false);
  return emp;
}

export async function updateEmployee(
  id: string,
  updates: Partial<{
    name: string;
    role: string;
    phone: string;
    notes: string;
    isActive: boolean;
    performanceCoefficient: number;
    expectedSchedule: WeeklyExpectedSchedule;
  }>
): Promise<Employee> {
  let updatedEmp!: Employee;

  await dbClient.executeTransaction('employees', 'readwrite', async (stores) => {
    const existing = (await requestToPromise(
      stores['employees'].get(id)
    )) as Employee | undefined;
    if (!existing) {
      throw new Error('کارمند مورد نظر یافت نشد.');
    }

    const cleanName =
      updates.name !== undefined ? updates.name.trim() : existing.name;
    if (!cleanName) {
      throw new Error('نام کارمند نمی‌تواند خالی باشد.');
    }

    const coeff =
      updates.performanceCoefficient !== undefined
        ? Number(updates.performanceCoefficient)
        : existing.performanceCoefficient;

    updatedEmp = {
      ...existing,
      name: cleanName,
      role:
        updates.role !== undefined
          ? updates.role.trim() || 'کارمند'
          : existing.role,
      phone:
        updates.phone !== undefined
          ? updates.phone.trim() || undefined
          : existing.phone,
      notes:
        updates.notes !== undefined
          ? updates.notes.trim() || undefined
          : existing.notes,
      isActive:
        updates.isActive !== undefined ? updates.isActive : existing.isActive,
      performanceCoefficient:
        Number.isFinite(coeff) && coeff > 0
          ? Number(coeff.toFixed(2))
          : existing.performanceCoefficient,
      expectedSchedule: updates.expectedSchedule || existing.expectedSchedule,
      isDemo: false,
      updatedAt: new Date().toISOString()
    };

    await requestToPromise(stores['employees'].put(updatedEmp));
  });

  await loadPurchases(false);
  return updatedEmp;
}

export async function toggleEmployeeActive(id: string): Promise<Employee> {
  const all = get(employees);
  const target = all.find((e) => e.id === id);
  if (!target) throw new Error('کارمند یافت نشد.');
  return updateEmployee(id, { isActive: !target.isActive });
}

export async function addPurchase(data: {
  productName: string;
  quantity: number;
  unit: string;
  price: number;
  purchaseDate: string;
  employeeId?: string;
  supplier?: string;
  invoice?: string;
  notes?: string;
}): Promise<Purchase> {
  const empMap = get(employeeByIdMap);
  const selectedEmp = data.employeeId ? empMap.get(data.employeeId) : undefined;

  const { purchase } = await purchaseRepository.createPurchaseWithProduct({
    productName: data.productName,
    quantity: data.quantity,
    unit: data.unit,
    totalAmount: data.price,
    purchaseDate: data.purchaseDate,
    employeeId: data.employeeId,
    employeeNameSnapshot: selectedEmp?.name,
    supplierName: data.supplier,
    invoiceNumber: data.invoice,
    notes: data.notes
  });

  if (data.employeeId) {
    await settingsRepository.saveSettings({
      lastSelectedEmployeeId: data.employeeId
    });
  }

  await dbClient.executeTransaction(
    ['suppliers', 'inventory'],
    'readwrite',
    async (stores) => {
      const supplierName = data.supplier?.trim();
      if (supplierName) {
        const allSuppliers = (await requestToPromise(
          stores['suppliers'].getAll()
        )) as Supplier[];
        const existingSup = allSuppliers.find(
          (s) => normalizeProductKey(s.name) === normalizeProductKey(supplierName)
        );
        if (existingSup) {
          await requestToPromise(
            stores['suppliers'].put({
              ...existingSup,
              lastPurchaseDate:
                !existingSup.lastPurchaseDate ||
                data.purchaseDate >= existingSup.lastPurchaseDate
                  ? data.purchaseDate
                  : existingSup.lastPurchaseDate,
              totalPurchasesAmount: existingSup.totalPurchasesAmount + data.price,
              purchasesCount: existingSup.purchasesCount + 1,
              isDemo: false
            })
          );
        } else {
          await requestToPromise(
            stores['suppliers'].put({
              id: generateId('sup'),
              name: supplierName,
              category: 'تأمین‌کننده عمومی',
              phone: 'ثبت‌نشده',
              city: 'محلی',
              lastPurchaseDate: data.purchaseDate,
              totalPurchasesAmount: data.price,
              purchasesCount: 1,
              isDemo: false
            })
          );
        }
      }

      const allInventory = (await requestToPromise(
        stores['inventory'].getAll()
      )) as InventoryItem[];
      const existingInv = allInventory.find(
        (inv) =>
          normalizeProductKey(inv.productName) ===
          normalizeProductKey(data.productName)
      );
      if (existingInv) {
        await requestToPromise(
          stores['inventory'].put({
            ...existingInv,
            currentStock: Number(
              (existingInv.currentStock + data.quantity).toFixed(3)
            ),
            unit: data.unit,
            lastUpdated: data.purchaseDate,
            isDemo: false
          })
        );
      } else {
        await requestToPromise(
          stores['inventory'].put({
            id: generateId('inv'),
            productName: data.productName.trim(),
            category: 'مواد اولیه',
            currentStock: data.quantity,
            minStockThreshold: Math.max(1, Math.round(data.quantity * 0.25)),
            unit: data.unit,
            alertEnabled: false,
            lastUpdated: data.purchaseDate,
            isDemo: false
          })
        );
      }
    }
  );

  await loadPurchases(false);
  return purchase;
}

export async function updatePurchase(
  id: string,
  data: {
    productName: string;
    quantity: number;
    unit: string;
    price: number;
    purchaseDate: string;
    employeeId?: string;
    supplier?: string;
    invoice?: string;
    notes?: string;
  }
): Promise<Purchase> {
  const empMap = get(employeeByIdMap);
  const selectedEmp = data.employeeId ? empMap.get(data.employeeId) : undefined;

  const updated = await purchaseRepository.updatePurchase(id, {
    productName: data.productName,
    quantity: data.quantity,
    unit: data.unit,
    totalAmount: data.price,
    purchaseDate: data.purchaseDate,
    employeeId: data.employeeId,
    employeeNameSnapshot: selectedEmp?.name,
    supplierName: data.supplier,
    invoiceNumber: data.invoice,
    notes: data.notes
  });

  await loadPurchases(false);
  return updated;
}

export async function saveDailyTotalRevenue(input: {
  date: string;
  dailyTotalAmount: number;
  cashAmount?: number;
  cardAmount?: number;
  onlineAmount?: number;
  notes?: string;
}): Promise<RevenueDayRecord> {
  if (!input.date) throw new Error('تاریخ درآمد الزامی است.');
  if (!(input.dailyTotalAmount > 0)) {
    throw new Error('مبلغ کل درآمد روزانه باید بزرگ‌تر از صفر باشد.');
  }

  const now = new Date().toISOString();
  let savedRecord!: RevenueDayRecord;

  await dbClient.executeTransaction('revenues', 'readwrite', async (stores) => {
    const store = stores['revenues'];
    const all = (await requestToPromise(store.getAll())) as RevenueDayRecord[];
    const existing = all.find((r) => r.date === input.date);

    savedRecord = {
      id: existing ? existing.id : `rev_${input.date}`,
      date: input.date,
      mode: 'daily_total',
      dailyTotalAmount: Math.round(input.dailyTotalAmount),
      cashAmount: input.cashAmount ? Math.round(input.cashAmount) : undefined,
      cardAmount: input.cardAmount ? Math.round(input.cardAmount) : undefined,
      onlineAmount: input.onlineAmount ? Math.round(input.onlineAmount) : undefined,
      notes: input.notes?.trim() || undefined,
      entries: existing ? existing.entries : [],
      isDemo: false,
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now
    };

    await requestToPromise(store.put(savedRecord));
  });

  await loadPurchases(false);
  return savedRecord;
}

export async function addDetailedRevenueEntry(input: {
  date: string;
  category: RevenueCategory;
  description: string;
  quantity?: number;
  unitPrice?: number;
  amount: number;
  paymentMethod?: PaymentMethod;
  notes?: string;
}): Promise<RevenueDayRecord> {
  if (!input.date) throw new Error('تاریخ تراکنش الزامی است.');
  if (!(input.amount > 0)) {
    throw new Error('مبلغ تراکنش درآمدی باید بزرگ‌تر از صفر باشد.');
  }

  const now = new Date().toISOString();
  const newItem: RevenueItemEntry = {
    id: generateId('rev_item'),
    category: input.category || 'فروش غذا (سالن)',
    description: input.description.trim() || input.category,
    quantity: input.quantity && input.quantity > 0 ? input.quantity : undefined,
    unitPrice: input.unitPrice && input.unitPrice > 0 ? Math.round(input.unitPrice) : undefined,
    amount: Math.round(input.amount),
    paymentMethod: input.paymentMethod,
    notes: input.notes?.trim() || undefined,
    createdAt: now
  };

  let savedRecord!: RevenueDayRecord;

  await dbClient.executeTransaction('revenues', 'readwrite', async (stores) => {
    const store = stores['revenues'];
    const all = (await requestToPromise(store.getAll())) as RevenueDayRecord[];
    const existing = all.find((r) => r.date === input.date);

    const updatedEntries = existing ? [...existing.entries, newItem] : [newItem];
    const entriesSum = updatedEntries.reduce((s, e) => s + e.amount, 0);

    savedRecord = {
      id: existing ? existing.id : `rev_${input.date}`,
      date: input.date,
      mode: 'detailed',
      dailyTotalAmount: existing?.dailyTotalAmount || entriesSum,
      cashAmount: existing?.cashAmount,
      cardAmount: existing?.cardAmount,
      onlineAmount: existing?.onlineAmount,
      notes: existing?.notes,
      entries: updatedEntries,
      isDemo: false,
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now
    };

    await requestToPromise(store.put(savedRecord));
  });

  await loadPurchases(false);
  return savedRecord;
}

export async function switchRevenueDayMode(
  date: string,
  newMode: RevenueRecordingMode
): Promise<void> {
  await dbClient.executeTransaction('revenues', 'readwrite', async (stores) => {
    const store = stores['revenues'];
    const all = (await requestToPromise(store.getAll())) as RevenueDayRecord[];
    const existing = all.find((r) => r.date === date);
    if (!existing) return;

    await requestToPromise(
      store.put({
        ...existing,
        mode: newMode,
        isDemo: false,
        updatedAt: new Date().toISOString()
      })
    );
  });

  await loadPurchases(false);
}

export async function deleteDetailedRevenueEntry(
  date: string,
  entryId: string
): Promise<void> {
  await dbClient.executeTransaction('revenues', 'readwrite', async (stores) => {
    const store = stores['revenues'];
    const all = (await requestToPromise(store.getAll())) as RevenueDayRecord[];
    const existing = all.find((r) => r.date === date);
    if (!existing) return;

    const updatedEntries = existing.entries.filter((e) => e.id !== entryId);
    await requestToPromise(
      store.put({
        ...existing,
        entries: updatedEntries,
        isDemo: false,
        updatedAt: new Date().toISOString()
      })
    );
  });

  await loadPurchases(false);
}

export async function deleteRevenueDayRecord(id: string): Promise<void> {
  await dbClient.executeTransaction('revenues', 'readwrite', async (stores) => {
    await requestToPromise(stores['revenues'].delete(id));
  });
  await loadPurchases(false);
}

export async function addTimesheetEntry(input: {
  employeeId: string;
  date: string;
  clockIn: string;
  clockOut: string;
  breakMinutes: number;
  allowOvernight?: boolean;
  notes?: string;
}): Promise<TimesheetEntry> {
  if (!input.employeeId) {
    throw new Error('لطفاً کارمند را انتخاب کنید.');
  }
  if (!input.date) {
    throw new Error('لطفاً تاریخ کاری را مشخص کنید.');
  }

  const calc = calculateShiftDuration({
    clockIn: input.clockIn,
    clockOut: input.clockOut,
    breakMinutes: input.breakMinutes,
    allowOvernight: input.allowOvernight
  });

  if (!calc.isValid) {
    throw new Error(calc.error || 'بازه زمانی ورود و خروج نامعتبر است.');
  }

  const now = new Date().toISOString();
  const entry: TimesheetEntry = {
    id: generateId('ts'),
    employeeId: input.employeeId,
    date: input.date,
    clockIn: calc.normalizedClockIn,
    clockOut: calc.normalizedClockOut,
    overnight: calc.overnight,
    breakMinutes: Math.max(0, Math.round(Number(input.breakMinutes) || 0)),
    netMinutes: calc.netMinutes,
    notes: input.notes?.trim() || undefined,
    editHistory: [],
    isDemo: false,
    createdAt: now,
    updatedAt: now
  };

  await dbClient.executeTransaction('timesheets', 'readwrite', async (stores) => {
    await requestToPromise(stores['timesheets'].put(entry));
  });

  await loadPurchases(false);
  return entry;
}

export async function updateTimesheetEntry(
  id: string,
  updates: {
    clockIn: string;
    clockOut: string;
    breakMinutes: number;
    allowOvernight?: boolean;
    notes?: string;
    editReason?: string;
  }
): Promise<TimesheetEntry> {
  const calc = calculateShiftDuration({
    clockIn: updates.clockIn,
    clockOut: updates.clockOut,
    breakMinutes: updates.breakMinutes,
    allowOvernight: updates.allowOvernight
  });

  if (!calc.isValid) {
    throw new Error(calc.error || 'بازه زمانی ورود و خروج نامعتبر است.');
  }

  let updatedEntry!: TimesheetEntry;

  await dbClient.executeTransaction('timesheets', 'readwrite', async (stores) => {
    const existing = (await requestToPromise(
      stores['timesheets'].get(id)
    )) as TimesheetEntry | undefined;
    if (!existing) {
      throw new Error('ردیف حضور و غیاب یافت نشد.');
    }

    const now = new Date().toISOString();
    const editLog: TimesheetEditLog = {
      editedAt: now,
      previousClockIn: existing.clockIn,
      previousClockOut: existing.clockOut,
      previousBreakMinutes: existing.breakMinutes,
      reason: updates.editReason?.trim() || undefined
    };

    updatedEntry = {
      ...existing,
      clockIn: calc.normalizedClockIn,
      clockOut: calc.normalizedClockOut,
      overnight: calc.overnight,
      breakMinutes: Math.max(0, Math.round(Number(updates.breakMinutes) || 0)),
      netMinutes: calc.netMinutes,
      notes:
        updates.notes !== undefined
          ? updates.notes.trim() || undefined
          : existing.notes,
      editHistory: [...(existing.editHistory || []), editLog],
      isDemo: false,
      updatedAt: now
    };

    await requestToPromise(stores['timesheets'].put(updatedEntry));
  });

  await loadPurchases(false);
  return updatedEntry;
}

export async function deleteTimesheetEntry(id: string): Promise<void> {
  await dbClient.executeTransaction('timesheets', 'readwrite', async (stores) => {
    await requestToPromise(stores['timesheets'].delete(id));
  });
  await loadPurchases(false);
}

export async function addSupplier(input: {
  name: string;
  category: string;
  phone: string;
  city: string;
  notes?: string;
}): Promise<Supplier> {
  const newSupplier: Supplier = {
    id: generateId('sup'),
    name: input.name.trim(),
    category: input.category.trim() || 'عمومی',
    phone: input.phone.trim() || 'ثبت‌نشده',
    city: input.city.trim() || 'رشت',
    notes: input.notes?.trim() || undefined,
    totalPurchasesAmount: 0,
    purchasesCount: 0,
    isDemo: false
  };

  await dbClient.executeTransaction('suppliers', 'readwrite', async (stores) => {
    await requestToPromise(stores['suppliers'].put(newSupplier));
  });

  await loadPurchases(false);
  return newSupplier;
}

export async function updateInventoryStock(
  id: string,
  delta: number
): Promise<void> {
  await dbClient.executeTransaction('inventory', 'readwrite', async (stores) => {
    const existing = (await requestToPromise(
      stores['inventory'].get(id)
    )) as InventoryItem | undefined;
    if (!existing) return;
    const updated: InventoryItem = {
      ...existing,
      currentStock: Math.max(0, Number((existing.currentStock + delta).toFixed(3))),
      lastUpdated: getTodayISODate(),
      isDemo: false
    };
    await requestToPromise(stores['inventory'].put(updated));
  });
  await loadPurchases(false);
}

export async function toggleInventoryAlert(
  id: string,
  enabled: boolean
): Promise<void> {
  await dbClient.executeTransaction('inventory', 'readwrite', async (stores) => {
    const existing = (await requestToPromise(
      stores['inventory'].get(id)
    )) as InventoryItem | undefined;
    if (!existing) return;
    const updated: InventoryItem = {
      ...existing,
      alertEnabled: enabled
    };
    await requestToPromise(stores['inventory'].put(updated));
  });
  await loadPurchases(false);
}

export async function addInventoryItem(input: {
  productName: string;
  category: string;
  currentStock: number;
  minStockThreshold: number;
  unit: string;
  alertEnabled?: boolean;
}): Promise<void> {
  const item: InventoryItem = {
    id: generateId('inv'),
    productName: input.productName.trim(),
    category: input.category.trim() || 'مواد اولیه',
    currentStock: input.currentStock,
    minStockThreshold: input.minStockThreshold,
    unit: input.unit,
    alertEnabled: Boolean(input.alertEnabled),
    lastUpdated: getTodayISODate(),
    isDemo: false
  };
  await dbClient.executeTransaction('inventory', 'readwrite', async (stores) => {
    await requestToPromise(stores['inventory'].put(item));
  });
  await loadPurchases(false);
}

export async function addExpense(input: {
  title: string;
  category: string;
  amount: number;
  expenseDate: string;
  notes?: string;
}): Promise<Expense> {
  const expense: Expense = {
    id: generateId('exp'),
    title: input.title.trim(),
    category: input.category,
    amount: Math.round(input.amount),
    expenseDate: input.expenseDate,
    notes: input.notes?.trim() || undefined,
    isDemo: false,
    createdAt: new Date().toISOString()
  };

  await dbClient.executeTransaction('expenses', 'readwrite', async (stores) => {
    await requestToPromise(stores['expenses'].put(expense));
  });

  await loadPurchases(false);
  return expense;
}

export const todayPurchasesStats = derived(purchases, ($purchases) => {
  const today = getTodayISODate();
  const todayItems = $purchases.filter((p) => p.purchaseDate === today);
  const stats = calculatePurchaseStats(todayItems);
  return { ...stats, items: todayItems };
});

export const recentPurchases = derived(purchases, ($purchases) => {
  return sortPurchasesDescending($purchases).slice(0, 4);
});

export const publicRevenueStore = derived(
  [revenues, appSettings],
  ([$revenues, $appSettings]) => {
    const coeff = $appSettings.globalRevenueCoefficient ?? 0.6;
    return buildPublicRevenueView($revenues, coeff);
  }
);

export const dashboardSummary = derived(
  [purchases, products, suppliers, inventory, expenses, employees],
  ([$purchases, $products, $suppliers, $inventory, $expenses, $employees]) => {
    const allPurchaseStats = calculatePurchaseStats($purchases);
    const demoCount = $purchases.filter((p) => p.isDemo).length;
    const realCount = $purchases.length - demoCount;
    const lowStock = getLowStockItems($inventory);
    const totalExpenses = calculateExpensesTotal($expenses);

    return {
      totalPurchasesAmount: allPurchaseStats.total,
      totalPurchasesCount: allPurchaseStats.count,
      averagePurchaseAmount: allPurchaseStats.average,
      demoCount,
      realCount,
      productsCount: $products.length,
      suppliersCount: $suppliers.length,
      employeesCount: $employees.length,
      activeEmployeesCount: $employees.filter((e) => e.isActive).length,
      lowStockItems: lowStock,
      totalExpenses,
      combinedOutflow: allPurchaseStats.total + totalExpenses
    };
  }
);
