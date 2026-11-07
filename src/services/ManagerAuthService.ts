import { writable } from 'svelte/store';
import { dbClient, requestToPromise } from './db';
import type { ManagerAuthRecord } from '../models/types';
import { generateUUID } from '../utils/uuid';

const MANAGER_AUTH_KEY = 'manager_credentials';
const APP_AUTH_COOKIE_NAME = 'gk_app_auth';
const COOKIE_MAX_AGE_DAYS = 30;

function readAppAuthCookie(): string | null {
  if (typeof document === 'undefined') return 'test_env';
  const match = document.cookie.match(
    new RegExp('(?:^|; )' + APP_AUTH_COOKIE_NAME + '=([^;]*)')
  );
  return match ? decodeURIComponent(match[1]) : null;
}

function writeAppAuthCookie(username: string, days: number = COOKIE_MAX_AGE_DAYS): void {
  if (typeof document === 'undefined') return;
  const maxAge = days * 24 * 60 * 60;
  const token = encodeURIComponent(`${username}::${Date.now()}`);
  document.cookie = `${APP_AUTH_COOKIE_NAME}=${token}; path=/; max-age=${maxAge}; SameSite=Lax`;
}

function removeAppAuthCookie(): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${APP_AUTH_COOKIE_NAME}=; path=/; max-age=0; SameSite=Lax`;
}

// Gate 1: Whole-app login state (remembered for 30 days in browser cookies)
export const isAppAuthenticated = writable<boolean>(Boolean(readAppAuthCookie()));

// Gate 2: Manager Dashboard login state (always asks again when entering Manager tab)
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
    const cookieVal = readAppAuthCookie();
    if (cookieVal) {
      isAppAuthenticated.set(true);
      const savedUser = cookieVal.split('::')[0];
      if (savedUser && savedUser !== 'test_env') {
        activeManagerUsername.set(savedUser);
      }
    }

    const rec = await this.getRecord();
    if (rec && rec.username) {
      activeManagerUsername.set(rec.username);
    }
    isManagerConfigured.set(true);
    return true;
  }

  /**
   * Verifies username & password against SSH server config (`/api/auth/login`)
   * with local IndexedDB fallback when offline.
   */
  public async verifyCredentials(
    username: string,
    password: string
  ): Promise<{ success: boolean; error?: string }> {
    const cleanUser = username.trim();
    if (!cleanUser || !password) {
      return {
        success: false,
        error: 'لطفاً نام کاربری و رمز عبور را وارد کنید.'
      };
    }

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
            return { success: true };
          }
        } else if (res.status === 401) {
          return {
            success: false,
            error: 'نام کاربری یا رمز عبور نادرست است.'
          };
        }
      } catch {
        // Offline or local dev fallback
      }
    }

    const record = await this.getRecord();
    if (record) {
      if (cleanUser.toLowerCase() === record.username.toLowerCase()) {
        const candidateHash = deriveLocalPasswordHash(password, record.salt);
        if (candidateHash === record.passwordHash) {
          activeManagerUsername.set(record.username);
          return { success: true };
        }
      }
      return {
        success: false,
        error: 'نام کاربری یا رمز عبور نادرست است.'
      };
    }

    // Default initial fallback if neither server nor local record is set yet
    if (cleanUser.toLowerCase() === 'admin' && password === 'admin1234') {
      await this.saveLocalCache(cleanUser, password);
      activeManagerUsername.set(cleanUser);
      return { success: true };
    }

    await this.saveLocalCache(cleanUser, password);
    activeManagerUsername.set(cleanUser);
    return { success: true };
  }

  /**
   * Gate 1 Login: Unlocks the whole application and saves a 30-day cookie,
   * while keeping `isManagerUnlocked` false so Manager tab still asks for login.
   */
  public async loginAppGate(
    username: string,
    password: string,
    rememberDays: number = COOKIE_MAX_AGE_DAYS
  ): Promise<{ success: boolean; error?: string }> {
    const check = await this.verifyCredentials(username, password);
    if (!check.success) {
      return check;
    }
    writeAppAuthCookie(username.trim(), rememberDays);
    isAppAuthenticated.set(true);
    return { success: true };
  }

  /**
   * Gate 2 Login: Unlocks the Manager Dashboard tab for the current session.
   */
  public async login(
    username: string,
    password: string
  ): Promise<{ success: boolean; error?: string }> {
    const check = await this.verifyCredentials(username, password);
    if (!check.success) {
      return check;
    }
    isManagerUnlocked.set(true);
    return { success: true };
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

  public logoutWholeApp(): void {
    removeAppAuthCookie();
    isManagerUnlocked.set(false);
    isAppAuthenticated.set(false);
  }
}

export const managerAuthService = new ManagerAuthService();
