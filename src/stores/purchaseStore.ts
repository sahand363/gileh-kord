import { writable, derived, get } from 'svelte/store';
import type {
  ApplicationSettings,
  Employee,
  Expense,
  InventoryItem,
  MenuCategory,
  MenuItem,
  PaymentMethod,
  Product,
  Purchase,
  RevenueCategory,
  RevenueDayRecord,
  RevenueItemEntry,
  RevenueRecordingMode,
  Supplier,
  SyncSnapshotMeta,
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
import { backupService } from '../services/BackupService';
import { apiClient, type ServerSyncMeta } from '../services/api/apiClient';
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
import {
  managerAuthService,
  activeManagerUsername
} from '../services/ManagerAuthService';

export const purchases = writable<Purchase[]>([]);
export const products = writable<Product[]>([]);
export const suppliers = writable<Supplier[]>([]);
export const inventory = writable<InventoryItem[]>([]);
export const expenses = writable<Expense[]>([]);
export const employees = writable<Employee[]>([]);
export const revenues = writable<RevenueDayRecord[]>([]);
export const timesheets = writable<TimesheetEntry[]>([]);
export const menuItems = writable<MenuItem[]>([]);
export const syncSnapshots = writable<SyncSnapshotMeta[]>([]);
export const pendingServerUpdate = writable<ServerSyncMeta | null>(null);
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

export async function syncLocalStateToServer(actionSummary: string): Promise<void> {
  if (!apiClient.isEnabled()) return;
  try {
    const backup = await backupService.exportBackup();
    const actor = get(activeManagerUsername) || 'کاربر';
    const res = await apiClient.pushFullStateToServer(backup, actor, actionSummary);
    if (res && res.updatedAt) {
      const saved = await settingsRepository.saveSettings({
        lastSyncAt: res.updatedAt,
        demoSeedInitialized: true
      });
      appSettings.set(saved);
      pendingServerUpdate.set(null);
      await refreshSnapshotsList();
    }
  } catch {
    // Offline or test environment: local IndexedDB remains intact
  }
}

export async function refreshSnapshotsList(): Promise<void> {
  if (!apiClient.isEnabled()) return;
  try {
    const list = await apiClient.listSnapshots();
    syncSnapshots.set(list);
  } catch {
    // Ignore when offline
  }
}

export async function checkForServerUpdates(): Promise<void> {
  if (!apiClient.isEnabled()) return;
  try {
    const meta = await apiClient.getSyncMeta();
    if (!meta || !meta.updatedAt) return;

    const settings = await settingsRepository.getSettings();
    const localPurchases = get(purchases);
    const onlyHasDemoOrEmpty =
      localPurchases.length === 0 || localPurchases.every((p) => p.isDemo);

    if (
      !settings.lastSyncAt ||
      meta.updatedAt > settings.lastSyncAt ||
      onlyHasDemoOrEmpty
    ) {
      pendingServerUpdate.set(meta);
    }
  } catch {
    // Ignore if offline
  }
}

export async function acceptServerUpdate(): Promise<void> {
  isLoading.set(true);
  try {
    const remote = await apiClient.pullFullStateFromServer();
    if (remote && remote.state) {
      await backupService.restoreBackup(remote.state);
      const saved = await settingsRepository.saveSettings({
        lastSyncAt: remote.updatedAt,
        demoSeedInitialized: true
      });
      appSettings.set(saved);
      pendingServerUpdate.set(null);
      await loadPurchases(false);
    }
  } finally {
    isLoading.set(false);
  }
}

export function dismissServerUpdatePrompt(): void {
  pendingServerUpdate.set(null);
}

export async function revertServerToSnapshot(snapshotId: string): Promise<void> {
  const actor = get(activeManagerUsername) || 'مدیر';
  const res = await apiClient.revertToSnapshot(snapshotId, actor);
  if (res && res.state) {
    await backupService.restoreBackup(res.state);
    const saved = await settingsRepository.saveSettings({
      lastSyncAt: res.updatedAt,
      demoSeedInitialized: true
    });
    appSettings.set(saved);
    pendingServerUpdate.set(null);
    await loadPurchases(false);
    await refreshSnapshotsList();
  }
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
      timesheetsList,
      menuItemsList
    ] = await Promise.all([
      purchaseRepository.getAll(),
      productRepository.getAll(),
      readStoreAll<Supplier>('suppliers'),
      readStoreAll<InventoryItem>('inventory'),
      readStoreAll<Expense>('expenses'),
      readStoreAll<Employee>('employees'),
      readStoreAll<RevenueDayRecord>('revenues'),
      readStoreAll<TimesheetEntry>('timesheets'),
      readStoreAll<MenuItem>('menu_items')
    ]);

    if (
      autoSeedDemoIfFirstRun &&
      !settings.demoSeedInitialized &&
      purchasesList.length === 0 &&
      employeesList.length === 0 &&
      revenuesList.length === 0
    ) {
      if (apiClient.isEnabled()) {
        const meta = await apiClient.getSyncMeta();
        if (meta && meta.updatedAt) {
          pendingServerUpdate.set(meta);
          const updatedSettings = await settingsRepository.saveSettings({
            demoSeedInitialized: true
          });
          appSettings.set(updatedSettings);
          return;
        }
      }
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
    menuItems.set(
      menuItemsList.sort(
        (a, b) =>
          a.category.localeCompare(b.category) || a.name.localeCompare(b.name)
      )
    );
    appSettings.set(settings);

    if (autoSeedDemoIfFirstRun) {
      void checkForServerUpdates();
      void refreshSnapshotsList();
    }
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
        'timesheets',
        'menu_items'
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
  void syncLocalStateToServer(`تغییر ضریب فرانت‌اند به ${cleanCoeff}`);
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
  void syncLocalStateToServer(`افزودن کارمند: ${emp.name}`);
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
  void syncLocalStateToServer(`ویرایش اطلاعات/ضریب کارمند: ${updatedEmp.name}`);
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
  void syncLocalStateToServer(`ثبت خرید: ${purchase.productName}`);
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
  void syncLocalStateToServer(`ویرایش خرید: ${updated.productName}`);
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
  void syncLocalStateToServer(`ثبت درآمد روزانه (${input.date})`);
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
  void syncLocalStateToServer(`ثبت ردیف فروش (${input.date})`);
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
  void syncLocalStateToServer(`تغییر حالت درآمد روز (${date})`);
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
  void syncLocalStateToServer(`حذف ردیف فروش (${date})`);
}

export async function deleteRevenueDayRecord(id: string): Promise<void> {
  await dbClient.executeTransaction('revenues', 'readwrite', async (stores) => {
    await requestToPromise(stores['revenues'].delete(id));
  });
  await loadPurchases(false);
  void syncLocalStateToServer(`حذف رکورد درآمد (${id})`);
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
  void syncLocalStateToServer(`ثبت تایم‌شیت (${entry.date})`);
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
  void syncLocalStateToServer(`ویرایش تایم‌شیت (${updatedEntry.date})`);
  return updatedEntry;
}

export async function deleteTimesheetEntry(id: string): Promise<void> {
  await dbClient.executeTransaction('timesheets', 'readwrite', async (stores) => {
    await requestToPromise(stores['timesheets'].delete(id));
  });
  await loadPurchases(false);
  void syncLocalStateToServer('حذف رکورد تایم‌شیت');
}

export async function addMenuItem(input: {
  name: string;
  category: MenuCategory;
  price: number;
  isAvailable?: boolean;
  description?: string;
}): Promise<MenuItem> {
  const cleanName = input.name.trim();
  if (!cleanName) throw new Error('نام آیتم منو الزامی است.');
  if (!(input.price >= 0)) throw new Error('قیمت منو نامعتبر است.');

  const now = new Date().toISOString();
  const item: MenuItem = {
    id: generateId('menu'),
    name: cleanName,
    category: input.category.trim() || 'غذای اصلی و کباب‌ها',
    price: Math.round(input.price),
    isAvailable: input.isAvailable !== false,
    description: input.description?.trim() || undefined,
    isDemo: false,
    createdAt: now,
    updatedAt: now
  };

  await dbClient.executeTransaction('menu_items', 'readwrite', async (stores) => {
    await requestToPromise(stores['menu_items'].put(item));
  });

  await loadPurchases(false);
  void syncLocalStateToServer(`افزودن به منو: ${item.name}`);
  return item;
}

export async function updateMenuItem(
  id: string,
  updates: Partial<{
    name: string;
    category: MenuCategory;
    price: number;
    isAvailable: boolean;
    description: string;
  }>
): Promise<MenuItem> {
  let updated!: MenuItem;
  await dbClient.executeTransaction('menu_items', 'readwrite', async (stores) => {
    const existing = (await requestToPromise(
      stores['menu_items'].get(id)
    )) as MenuItem | undefined;
    if (!existing) throw new Error('آیتم منو یافت نشد.');

    updated = {
      ...existing,
      name: updates.name !== undefined ? updates.name.trim() || existing.name : existing.name,
      category:
        updates.category !== undefined
          ? updates.category.trim() || existing.category
          : existing.category,
      price:
        updates.price !== undefined && updates.price >= 0
          ? Math.round(updates.price)
          : existing.price,
      isAvailable:
        updates.isAvailable !== undefined ? updates.isAvailable : existing.isAvailable,
      description:
        updates.description !== undefined
          ? updates.description.trim() || undefined
          : existing.description,
      updatedAt: new Date().toISOString()
    };

    await requestToPromise(stores['menu_items'].put(updated));
  });

  await loadPurchases(false);
  void syncLocalStateToServer(`ویرایش آیتم منو: ${updated.name}`);
  return updated;
}

export async function deleteMenuItem(id: string): Promise<void> {
  await dbClient.executeTransaction('menu_items', 'readwrite', async (stores) => {
    await requestToPromise(stores['menu_items'].delete(id));
  });
  await loadPurchases(false);
  void syncLocalStateToServer('حذف آیتم از منو');
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
  void syncLocalStateToServer(`افزودن تأمین‌کننده: ${newSupplier.name}`);
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
  void syncLocalStateToServer('بروزرسانی موجودی انبار');
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
  void syncLocalStateToServer('تغییر وضعیت هشدار موجودی انبار');
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
  void syncLocalStateToServer(`افزودن به انبار: ${item.productName}`);
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
  void syncLocalStateToServer(`ثبت هزینه: ${expense.title}`);
  return expense;
}

export async function updateExpense(
  id: string,
  updates: {
    title: string;
    category: string;
    amount: number;
    expenseDate: string;
    notes?: string;
  }
): Promise<Expense> {
  const cleanTitle = updates.title.trim();
  if (!cleanTitle) {
    throw new Error('عنوان هزینه الزامی است.');
  }
  if (!(updates.amount > 0)) {
    throw new Error('مبلغ هزینه باید بزرگ‌تر از صفر باشد.');
  }

  let updatedExpense!: Expense;

  await dbClient.executeTransaction('expenses', 'readwrite', async (stores) => {
    const existing = (await requestToPromise(
      stores['expenses'].get(id)
    )) as Expense | undefined;
    if (!existing) {
      throw new Error('ردیف هزینه مورد نظر یافت نشد.');
    }

    updatedExpense = {
      ...existing,
      title: cleanTitle,
      category: updates.category.trim() || existing.category,
      amount: Math.round(updates.amount),
      expenseDate: updates.expenseDate || existing.expenseDate,
      notes: updates.notes?.trim() || undefined,
      isDemo: false
    };

    await requestToPromise(stores['expenses'].put(updatedExpense));
  });

  await loadPurchases(false);
  void syncLocalStateToServer(`ویرایش هزینه: ${updatedExpense.title}`);
  return updatedExpense;
}

export async function deleteExpense(id: string): Promise<void> {
  await dbClient.executeTransaction('expenses', 'readwrite', async (stores) => {
    await requestToPromise(stores['expenses'].delete(id));
  });

  await loadPurchases(false);
  void syncLocalStateToServer('حذف ردیف هزینه');
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
