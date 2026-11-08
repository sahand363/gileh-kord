import { writable } from 'svelte/store';
import type {
  BackupData,
  Product,
  Purchase,
  SyncSnapshotMeta
} from '../../models/types';
import {
  getActiveCsrfToken,
  hasActiveSessionMeta,
  isAppAuthenticated,
  isManagerUnlocked
} from '../ManagerAuthService';

export type BackendConnectionState = 'disconnected' | 'checking' | 'connected';

export const backendStatus = writable<BackendConnectionState>('disconnected');

export interface ServerSyncMeta {
  revision?: number;
  updatedAt: string | null;
  lastActor: string;
  lastAction: string;
  counts: {
    purchases: number;
    revenues: number;
    employees: number;
    menuItems: number;
  };
}

export class SyncConflictError extends Error {
  public serverRevision: number;
  public updatedAt: string | null;
  public lastActor: string;
  public lastAction: string;

  constructor(
    message: string,
    meta: {
      serverRevision?: number;
      updatedAt?: string | null;
      lastActor?: string;
      lastAction?: string;
    }
  ) {
    super(message);
    this.name = 'SyncConflictError';
    this.serverRevision = Number(meta.serverRevision) || 0;
    this.updatedAt = meta.updatedAt || null;
    this.lastActor = meta.lastActor || 'کاربر';
    this.lastAction = meta.lastAction || 'بروزرسانی';
  }
}

export class ApiClient {
  private baseUrl = '';
  private enabled = false;
  private lastKnownRevision: number | null = null;

  public configure(options: { baseUrl?: string; enabled?: boolean }): void {
    if (options.baseUrl !== undefined) {
      this.baseUrl = options.baseUrl.trim().replace(/\/+$/, '');
    }
    if (options.enabled !== undefined) {
      this.enabled = options.enabled;
    }
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public getLastKnownRevision(): number | null {
    return this.lastKnownRevision;
  }

  public setLastKnownRevision(rev: number | undefined | null): void {
    if (typeof rev === 'number' && Number.isInteger(rev) && rev >= 0) {
      this.lastKnownRevision = rev;
    }
  }

  private buildUrl(path: string): string {
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    return `${this.baseUrl}${cleanPath}`;
  }

  private async request<T>(
    path: string,
    init?: RequestInit,
    timeoutMs = 5000
  ): Promise<T> {
    if (typeof fetch === 'undefined') {
      throw new Error('Fetch API is not available in this environment.');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const csrfToken = getActiveCsrfToken();
    const securityHeaders: Record<string, string> = {
      'X-Requested-With': 'XMLHttpRequest'
    };
    if (csrfToken) {
      securityHeaders['X-CSRF-Token'] = csrfToken;
    }

    try {
      const response = await fetch(this.buildUrl(path), {
        ...init,
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...securityHeaders,
          ...((init?.headers as Record<string, string>) || {})
        },
        signal: controller.signal
      });

      const data = await response.json().catch(() => null);
      if (!response.ok) {
        if (response.status === 401 && path !== '/api/health') {
          isManagerUnlocked.set(false);
          if (!hasActiveSessionMeta()) {
            isAppAuthenticated.set(false);
          }
        }
        if (response.status === 409 && data?.error) {
          if (typeof data.error.serverRevision === 'number') {
            this.setLastKnownRevision(data.error.serverRevision);
          }
          throw new SyncConflictError(
            data.error.message || 'تداخل نسخه همگام‌سازی روی سرور تشخیص داده شد.',
            {
              serverRevision: data.error.serverRevision,
              updatedAt: data.error.updatedAt,
              lastActor: data.error.lastActor,
              lastAction: data.error.lastAction
            }
          );
        }
        const message =
          data?.error?.message || `خطای ارتباط با سرور (${response.status})`;
        throw new Error(message);
      }

      backendStatus.set('connected');
      if (data && typeof data.revision === 'number') {
        this.setLastKnownRevision(data.revision);
      }
      return data as T;
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        backendStatus.set('disconnected');
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  public async checkHealth(): Promise<boolean> {
    try {
      backendStatus.set('checking');
      const res = await this.request<{ status: string }>('/api/health', {
        method: 'GET'
      });
      const ok = res?.status === 'ok';
      backendStatus.set(ok ? 'connected' : 'disconnected');
      return ok;
    } catch {
      backendStatus.set('disconnected');
      return false;
    }
  }

  public async getSyncMeta(): Promise<ServerSyncMeta | null> {
    if (!hasActiveSessionMeta()) return null;
    try {
      const meta = await this.request<ServerSyncMeta>('/api/sync/meta', {
        method: 'GET'
      });
      if (meta && typeof meta.revision === 'number') {
        this.setLastKnownRevision(meta.revision);
      }
      return meta;
    } catch {
      return null;
    }
  }

  public async pullFullStateFromServer(): Promise<{
    revision?: number;
    updatedAt: string;
    state: BackupData;
  }> {
    const res = await this.request<{
      revision?: number;
      updatedAt: string;
      state: BackupData;
    }>('/api/sync/state', { method: 'GET' }, 12000);
    if (res && typeof res.revision === 'number') {
      this.setLastKnownRevision(res.revision);
    }
    return res;
  }

  public async pushFullStateToServer(
    backup: BackupData,
    actor: string,
    actionSummary: string,
    forceOverwrite = false
  ): Promise<{
    ok: boolean;
    revision?: number;
    updatedAt: string;
    snapshotId: string;
  }> {
    // Ensure we always send a valid integer baseRevision
    if (this.lastKnownRevision === null) {
      const meta = await this.getSyncMeta();
      if (meta && typeof meta.revision === 'number' && Number.isInteger(meta.revision)) {
        this.lastKnownRevision = meta.revision;
      } else {
        this.lastKnownRevision = 0;
      }
    }

    const baseRevision = Math.max(0, Math.trunc(this.lastKnownRevision));
    const explicitForce = Boolean(forceOverwrite);

    return this.request(
      '/api/sync/push',
      {
        method: 'POST',
        body: JSON.stringify({
          actor,
          actionSummary,
          baseRevision,
          forceOverwrite: explicitForce,
          state: backup
        })
      },
      12000
    );
  }

  public async listSnapshots(): Promise<SyncSnapshotMeta[]> {
    const res = await this.request<{ items: SyncSnapshotMeta[] }>(
      '/api/sync/history',
      { method: 'GET' }
    );
    return res.items || [];
  }

  public async revertToSnapshot(
    snapshotId: string,
    actor: string
  ): Promise<{
    ok: boolean;
    revision?: number;
    updatedAt: string;
    state: BackupData;
  }> {
    return this.request(
      '/api/sync/revert',
      {
        method: 'POST',
        body: JSON.stringify({ snapshotId, actor })
      },
      12000
    );
  }

  public async listProducts(query = ''): Promise<Product[]> {
    if (!hasActiveSessionMeta()) return [];
    const q = query ? `?query=${encodeURIComponent(query)}` : '';
    const res = await this.request<{ items: Product[] }>(`/api/products${q}`);
    return res.items || [];
  }

  public async listPurchases(params?: {
    query?: string;
    dateFrom?: string;
    dateTo?: string;
    employeeId?: string;
    supplierName?: string;
    pageSize?: number;
  }): Promise<Purchase[]> {
    if (!hasActiveSessionMeta()) return [];
    const search = new URLSearchParams();
    if (params?.query) search.set('query', params.query);
    if (params?.dateFrom) search.set('date_from', params.dateFrom);
    if (params?.dateTo) search.set('date_to', params.dateTo);
    if (params?.employeeId) search.set('employee_id', params.employeeId);
    if (params?.supplierName) search.set('supplier', params.supplierName);
    search.set('page_size', String(params?.pageSize || 500));

    const qs = search.toString();
    const res = await this.request<{ items: Purchase[] }>(
      `/api/purchases${qs ? `?${qs}` : ''}`
    );
    return res.items || [];
  }

  public async createPurchase(input: {
    id?: string;
    productName: string;
    quantity: number;
    unit: string;
    totalAmount: number;
    purchaseDate: string;
    employeeId?: string;
    employeeNameSnapshot?: string;
    supplierName?: string;
    invoiceNumber?: string;
    notes?: string;
  }): Promise<{ purchase: Purchase; product: Product }> {
    return this.request<{ purchase: Purchase; product: Product }>(
      '/api/purchases',
      {
        method: 'POST',
        body: JSON.stringify(input)
      }
    );
  }

  public async updatePurchase(
    id: string,
    input: {
      productName: string;
      quantity: number;
      unit: string;
      totalAmount: number;
      purchaseDate: string;
      employeeId?: string;
      employeeNameSnapshot?: string;
      supplierName?: string;
      invoiceNumber?: string;
      notes?: string;
    }
  ): Promise<Purchase> {
    return this.request<Purchase>(`/api/purchases/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(input)
    });
  }

  public async importBackupToSQLite(backup: BackupData): Promise<{
    imported: boolean;
    importedProducts: number;
    importedSuppliers: number;
    importedEmployees: number;
    importedPurchases: number;
  }> {
    return this.request(
      '/api/import/backup',
      {
        method: 'POST',
        body: JSON.stringify(backup)
      },
      15000
    );
  }
}

export const apiClient = new ApiClient();
