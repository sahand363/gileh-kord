import { normalizeProductKey } from '../utils/formatters';

export const DB_NAME = 'gileh_kord_db';
export const DB_VERSION = 3;

export const ALL_STORES = [
  'purchases',
  'products',
  'suppliers',
  'inventory',
  'expenses',
  'settings'
] as const;

export class IndexedDBClient {
  private db: IDBDatabase | null = null;
  private initPromise: Promise<IDBDatabase> | null = null;

  public async getDB(): Promise<IDBDatabase> {
    if (this.db) return this.db;
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        this.initPromise = null;
        reject(new Error('IndexedDB در این مرورگر یا محیط فعال نیست.'));
        return;
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        this.initPromise = null;
        reject(
          new Error(
            `خطا در باز کردن پایگاه داده محلی: ${request.error?.message || 'Unknown error'}`
          )
        );
      };

      request.onblocked = () => {
        this.initPromise = null;
        reject(
          new Error(
            'پایگاه داده در تب دیگری باز است. لطفاً سایر تب‌های برنامه را ببندید.'
          )
        );
      };

      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          this.db = null;
          this.initPromise = null;
        };
        db.onclose = () => {
          this.db = null;
          this.initPromise = null;
        };
        this.db = db;
        resolve(db);
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        const tx = (event.target as IDBOpenDBRequest).transaction!;
        this.runMigrations(db, event.oldVersion, tx);
      };
    });

    return this.initPromise;
  }

  private runMigrations(
    db: IDBDatabase,
    oldVersion: number,
    tx: IDBTransaction
  ): void {
    if (oldVersion < 1) {
      if (!db.objectStoreNames.contains('purchases')) {
        const purchaseStore = db.createObjectStore('purchases', { keyPath: 'id' });
        purchaseStore.createIndex('purchaseDate', 'purchaseDate', { unique: false });
        purchaseStore.createIndex('productName', 'productName', { unique: false });
        purchaseStore.createIndex('createdAt', 'createdAt', { unique: false });
      }

      if (!db.objectStoreNames.contains('products')) {
        const productStore = db.createObjectStore('products', { keyPath: 'id' });
        productStore.createIndex('name', 'name', { unique: false });
        productStore.createIndex('normalizedName', 'normalizedName', { unique: false });
      }

      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    }

    if (oldVersion >= 1 && oldVersion < 2) {
      if (db.objectStoreNames.contains('products')) {
        const productStore = tx.objectStore('products');
        if (productStore.indexNames.contains('name')) {
          productStore.deleteIndex('name');
        }
        productStore.createIndex('name', 'name', { unique: false });

        if (!productStore.indexNames.contains('normalizedName')) {
          productStore.createIndex('normalizedName', 'normalizedName', {
            unique: false
          });
        }

        const cursorReq = productStore.openCursor();
        cursorReq.onsuccess = (e) => {
          const cursor = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
          if (cursor) {
            const value = cursor.value;
            if (value && typeof value.name === 'string' && !value.normalizedName) {
              value.normalizedName = normalizeProductKey(value.name);
              cursor.update(value);
            }
            cursor.continue();
          }
        };
      }
    }

    if (oldVersion < 3) {
      if (!db.objectStoreNames.contains('suppliers')) {
        const supplierStore = db.createObjectStore('suppliers', { keyPath: 'id' });
        supplierStore.createIndex('name', 'name', { unique: false });
      }

      if (!db.objectStoreNames.contains('inventory')) {
        const inventoryStore = db.createObjectStore('inventory', { keyPath: 'id' });
        inventoryStore.createIndex('productName', 'productName', { unique: false });
      }

      if (!db.objectStoreNames.contains('expenses')) {
        const expenseStore = db.createObjectStore('expenses', { keyPath: 'id' });
        expenseStore.createIndex('expenseDate', 'expenseDate', { unique: false });
      }
    }
  }

  public async executeTransaction<T>(
    storeNames: string | string[],
    mode: IDBTransactionMode,
    operation: (
      stores: Record<string, IDBObjectStore>,
      tx: IDBTransaction
    ) => Promise<T> | T
  ): Promise<T> {
    const db = await this.getDB();
    const names = Array.isArray(storeNames) ? storeNames : [storeNames];
    const tx = db.transaction(names, mode);

    const storeMap: Record<string, IDBObjectStore> = {};
    for (const name of names) {
      storeMap[name] = tx.objectStore(name);
    }

    return new Promise<T>((resolve, reject) => {
      let operationResult: T;
      let operationCompleted = false;
      let settled = false;

      const fail = (err: unknown) => {
        if (settled) return;
        settled = true;
        try {
          tx.abort();
        } catch {
          // Ignore if transaction already finished
        }
        reject(err instanceof Error ? err : new Error(String(err)));
      };

      tx.oncomplete = () => {
        if (settled) return;
        if (!operationCompleted) {
          settled = true;
          reject(new Error('تراکنش پایگاه داده پیش از تکمیل عملیات بسته شد.'));
          return;
        }
        settled = true;
        resolve(operationResult);
      };

      tx.onerror = () => {
        fail(tx.error || new Error('خطا در تراکنش پایگاه داده محلی.'));
      };

      tx.onabort = () => {
        fail(tx.error || new Error('تراکنش پایگاه داده لغو شد.'));
      };

      Promise.resolve()
        .then(() => operation(storeMap, tx))
        .then((res) => {
          operationResult = res;
          operationCompleted = true;
        })
        .catch((err) => {
          fail(err);
        });
    });
  }

  public close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.initPromise = null;
    }
  }
}

export const dbClient = new IndexedDBClient();

export function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IDBRequest failed'));
  });
}
