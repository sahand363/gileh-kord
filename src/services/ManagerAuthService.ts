import { writable } from 'svelte/store';
import { dbClient, requestToPromise } from './db';
import type { ManagerAuthRecord } from '../models/types';
import { generateUUID } from '../utils/uuid';

const MANAGER_AUTH_KEY = 'manager_credentials';

export const isManagerUnlocked = writable<boolean>(false);
export const isManagerConfigured = writable<boolean>(true);
export const activeManagerUsername = writable<string>('admin');

export function deriveLocalPasswordHash(password: string, salt: string): string {
  const input = `${salt}::gileh_kord_v1::${password}`;
  const state = new Uint32Array([
    0x6a09e667,
    0xbb67ae85,
    0x3c6ef372,
    0xa54ff53a,
    0x510e527f,
    0x9b05688c,
    0x1f83d9ab,
    0x5be0cd19
  ]);

  for (let round = 0; round < 2048; round++) {
    for (let i = 0; i < input.length; i++) {
      const code = input.charCodeAt(i) ^ (round & 0xff);
      const idx = (i + round) & 7;
      let h = state[idx] ^ code;
      h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
      h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
      state[idx] = (h ^ (h >>> 16)) >>> 0;
      state[(idx + 1) & 7] = (state[(idx + 1) & 7] + state[idx] + round) >>> 0;
    }
  }

  return Array.from(state)
    .map((n) => n.toString(16).padStart(8, '0'))
    .join('');
}

export class ManagerAuthService {
  public async getRecord(): Promise<ManagerAuthRecord | null> {
    try {
      return await dbClient.executeTransaction(
        'manager_auth',
        'readonly',
        async (stores) => {
          const rec = (await requestToPromise(
            stores['manager_auth'].get(MANAGER_AUTH_KEY)
          )) as ManagerAuthRecord | undefined;
          return rec || null;
        }
      );
    } catch {
      return null;
    }
  }

  private async saveLocalCache(username: string, password: string): Promise<void> {
    const salt = generateUUID();
    const passwordHash = deriveLocalPasswordHash(password, salt);
    const now = new Date().toISOString();
    const record: ManagerAuthRecord = {
      key: MANAGER_AUTH_KEY,
      username: username.trim(),
      passwordHash,
      salt,
      createdAt: now,
      updatedAt: now
    };
    await dbClient.executeTransaction('manager_auth', 'readwrite', async (stores) => {
      await requestToPromise(stores['manager_auth'].put(record));
    });
  }

  public async checkInitialized(): Promise<boolean> {
    const rec = await this.getRecord();
    if (rec && rec.username) {
      activeManagerUsername.set(rec.username);
    }
    // Master credentials are always available via SSH server config or local fallback
    isManagerConfigured.set(true);
    return true;
  }

  public async setupInitialAccount(
    username: string,
    password: string
  ): Promise<{ success: boolean; error?: string }> {
    const cleanUser = username.trim();
    if (cleanUser.length < 3) {
      return {
        success: false,
        error: 'نام کاربری مدیر باید حداقل ۳ کاراکتر باشد.'
      };
    }
    if (!password || password.length < 4) {
      return {
        success: false,
        error: 'رمز عبور باید حداقل ۴ کاراکتر باشد.'
      };
    }

    await this.saveLocalCache(cleanUser, password);
    isManagerConfigured.set(true);
    activeManagerUsername.set(cleanUser);
    isManagerUnlocked.set(true);
    return { success: true };
  }

  /**
   * Authenticates against the master username & password configured via SSH (`POST /api/auth/login`),
   * and falls back to the local IndexedDB hash when offline.
   */
  public async login(
    username: string,
    password: string
  ): Promise<{ success: boolean; error?: string }> {
    const cleanUser = username.trim();
    if (!cleanUser || !password) {
      return {
        success: false,
        error: 'لطفاً نام کاربری و رمز عبور مستر (تنظیم‌شده در SSH) را وارد کنید.'
      };
    }

    // 1. Try SSH-configured master credentials on the server first
    if (typeof fetch !== 'undefined') {
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: cleanUser, password })
        });
        if (res.ok) {
          const data = await res.json();
          if (data && data.ok) {
            await this.saveLocalCache(cleanUser, password);
            activeManagerUsername.set(cleanUser);
            isManagerUnlocked.set(true);
            return { success: true };
          }
        } else if (res.status === 401) {
          return {
            success: false,
            error: 'نام کاربری یا رمز عبور مستر نادرست است.'
          };
        }
      } catch {
        // Network offline or dev server: fall through to local IndexedDB verification
      }
    }

    // 2. Offline / Local IndexedDB fallback
    const record = await this.getRecord();
    if (record) {
      if (cleanUser.toLowerCase() === record.username.toLowerCase()) {
        const candidateHash = deriveLocalPasswordHash(password, record.salt);
        if (candidateHash === record.passwordHash) {
          activeManagerUsername.set(record.username);
          isManagerUnlocked.set(true);
          return { success: true };
        }
      }
      return {
        success: false,
        error: 'نام کاربری یا رمز عبور نادرست است.'
      };
    }

    // First-time local offline setup fallback if no server endpoint responded
    await this.saveLocalCache(cleanUser, password);
    activeManagerUsername.set(cleanUser);
    isManagerUnlocked.set(true);
    return { success: true };
  }

  public async changePassword(
    currentPassword: string,
    newPassword: string,
    newUsername?: string
  ): Promise<{ success: boolean; error?: string }> {
    if (!newPassword || newPassword.length < 4) {
      return {
        success: false,
        error: 'رمز عبور جدید باید حداقل ۴ کاراکتر باشد.'
      };
    }

    const record = await this.getRecord();
    if (record) {
      const currentHash = deriveLocalPasswordHash(currentPassword, record.salt);
      if (currentHash !== record.passwordHash) {
        return { success: false, error: 'رمز عبور فعلی نادرست است.' };
      }
    }

    const finalUser = newUsername?.trim() || record?.username || 'admin';
    await this.saveLocalCache(finalUser, newPassword);
    activeManagerUsername.set(finalUser);
    return { success: true };
  }

  public lock(): void {
    isManagerUnlocked.set(false);
  }
}

export const managerAuthService = new ManagerAuthService();
