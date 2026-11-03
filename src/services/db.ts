const DB_NAME = 'gileh_kord_db';
const DB_VERSION = 1;

export class IndexedDBClient {
  private db: IDBDatabase | null = null;
  private initPromise: Promise<IDBDatabase> | null = null;

  public async getDB(): Promise<IDBDatabase> {
    if (this.db) return this.db;
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        reject(new Error(`Failed to open IndexedDB: ${request.error?.message}`));
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        if (!db.objectStoreNames.contains('purchases')) {
          const purchaseStore = db.createObjectStore('purchases', { keyPath: 'id' });
          purchaseStore.createIndex('purchaseDate', 'purchaseDate', { unique: false });
          purchaseStore.createIndex('productName', 'productName', { unique: false });
          purchaseStore.createIndex('createdAt', 'createdAt', { unique: false });
        }

        if (!db.objectStoreNames.contains('products')) {
          const productStore = db.createObjectStore('products', { keyPath: 'id' });
          productStore.createIndex('name', 'name', { unique: true });
        }

        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      };
    });

    return this.initPromise;
  }

  public async executeTransaction<T>(
    storeNames: string | string[],
    mode: IDBTransactionMode,
    callback: (stores: { [name: string]: IDBObjectStore }) => Promise<T>
  ): Promise<T> {
    const db = await this.getDB();
    const names = Array.isArray(storeNames) ? storeNames : [storeNames];
    const tx = db.transaction(names, mode);

    const storeMap: { [name: string]: IDBObjectStore } = {};
    for (const name of names) {
      storeMap[name] = tx.objectStore(name);
    }

    return new Promise<T>((resolve, reject) => {
      let result: T;
      callback(storeMap)
        .then((res) => {
          result = res;
        })
        .catch(reject);

      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(new Error('IndexedDB transaction aborted'));
    });
  }
}

export const dbClient = new IndexedDBClient();
