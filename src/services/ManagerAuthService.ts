import { writable } from 'svelte/store';
import { dbClient, requestToPromise } from './db';
import type { ManagerAuthRecord } from '../models/types';
import { generateUUID } from '../utils/uuid';

const MANAGER_AUTH_KEY = 'manager_credentials';
const SESSION_TOKEN_STORAGE_KEY = 'gk_session_token';
const SESSION_USER_STORAGE_KEY = 'gk_session_user';
const SESSION_EXPIRES_STORAGE_KEY = 'gk_session_expires';

function readStoredSession(): { token: string; username: string } | null {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return null;
  }
  try {
    const token = localStorage.getItem(SESSION_TOKEN_STORAGE_KEY) || '';
    const username = localStorage.getItem(SESSION_USER_STORAGE_KEY) || '';
    const expiresRaw = Number(localStorage.getItem(SESSION_EXPIRES_STORAGE_KEY) || '0');
    if (!token || !username || (expiresRaw > 0 && expiresRaw <= Date.now())) {
      clearStoredSession();
      return null;
    }
    return { token, username };
  } catch {
    return null;
  }
}

function saveStoredSession(
  token: string,
  username: string,
  expiresAt: number
): void {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return;
  }
  try {
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, token);
    localStorage.setItem(SESSION_USER_STORAGE_KEY, username);
    localStorage.setItem(SESSION_EXPIRES_STORAGE_KEY, String(expiresAt));
  } catch {
    // Ignore storage quota errors
  }
}

function clearStoredSession(): void {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return;
  }
  try {
    localStorage.removeItem(SESSION_TOKEN_STORAGE_KEY);
    localStorage.removeItem(SESSION_USER_STORAGE_KEY);
    localStorage.removeItem(SESSION_EXPIRES_STORAGE_KEY);
  } catch {
    // Ignore
  }
}

export function getActiveSessionToken(): string {
  const session = readStoredSession();
  return session ? session.token : '';
}

function constantTimeHashCompare(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length || a.length === 0) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

const initialSession = readStoredSession();

// Gate 1: Whole-app login state (requires valid server token or verified offline cache)
export const isAppAuthenticated = writable<boolean>(Boolean(initialSession));

// Gate 2: Manager Dashboard login state (requires re-entering credentials on Manager tab)
export const isManagerUnlocked = writable<boolean>(false);
export const isManagerConfigured = writable<boolean>(false);
export const activeManagerUsername = writable<string>(
  initialSession ? initialSession.username : ''
);

export function deriveLocalPasswordHash(password: string, salt: string): string {
  const input = `${salt}::gileh_kord_v2_auth::${password}`;
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

  for (let round = 0; round < 4096; round++) {
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

  private async saveVerifiedLocalCache(
    username: string,
    password: string
  ): Promise<void> {
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
    const storedSession = readStoredSession();
    if (storedSession) {
      isAppAuthenticated.set(true);
      activeManagerUsername.set(storedSession.username);

      // Verify token validity with the server when online
      if (typeof fetch !== 'undefined') {
        try {
          const res = await fetch('/api/auth/session', {
            method: 'GET',
            headers: {
              Accept: 'application/json',
              Authorization: `Bearer ${storedSession.token}`
            },
            credentials: 'same-origin'
          });
          if (res.status === 401) {
            this.logoutWholeApp();
            return false;
          }
        } catch {
          // Offline: retain locally stored valid session until expiry
        }
      }
    } else {
      isAppAuthenticated.set(false);
    }

    const rec = await this.getRecord();
    if (rec && rec.username) {
      if (!storedSession) {
        activeManagerUsername.set(rec.username);
      }
      isManagerConfigured.set(true);
      return true;
    }

    isManagerConfigured.set(false);
    return false;
  }

  /**
   * Authenticates credentials against the server (`POST /api/auth/login`).
   * Offline fallback is strictly limited to verifying against an already-existing,
   * server-verified `ManagerAuthRecord` in IndexedDB. Never auto-creates credentials.
   */
  public async verifyCredentials(
    username: string,
    password: string,
    rememberDays: number = 30
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
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json'
          },
          credentials: 'same-origin',
          body: JSON.stringify({
            username: cleanUser,
            password,
            rememberDays
          })
        });

        const data = await res.json().catch(() => null);

        if (res.ok && data && data.ok && typeof data.token === 'string') {
          const verifiedUser = String(data.username || cleanUser);
          const expiresAt =
            Number(data.expiresAt) ||
            Date.now() + rememberDays * 24 * 60 * 60 * 1000;

          saveStoredSession(data.token, verifiedUser, expiresAt);
          await this.saveVerifiedLocalCache(verifiedUser, password);
          activeManagerUsername.set(verifiedUser);
          isManagerConfigured.set(true);
          return { success: true };
        }

        // Server explicitly rejected credentials or is unconfigured — never fall back to offline cache
        const serverErrMsg =
          data?.error?.message ||
          (typeof data?.error === 'string' ? data.error : null) ||
          'نام کاربری یا رمز عبور نادرست است.';
        return {
          success: false,
          error: serverErrMsg
        };
      } catch {
        // Network unreachable: proceed to strict offline cache check below
      }
    }

    // Strict Offline Verification: Only succeeds if a previously server-verified record exists
    const record = await this.getRecord();
    if (!record || !record.username || !record.passwordHash || !record.salt) {
      return {
        success: false,
        error:
          'ارتباط با سرور برقرار نیست. برای اولین ورود در این مرورگر، اتصال به سرور الزامی است.'
      };
    }

    const userMatches =
      cleanUser.toLowerCase() === record.username.trim().toLowerCase();
    const candidateHash = deriveLocalPasswordHash(password, record.salt);
    const hashMatches = constantTimeHashCompare(candidateHash, record.passwordHash);

    if (userMatches && hashMatches) {
      activeManagerUsername.set(record.username);
      isManagerConfigured.set(true);
      return { success: true };
    }

    return {
      success: false,
      error: 'نام کاربری یا رمز عبور نادرست است.'
    };
  }

  public async loginAppGate(
    username: string,
    password: string,
    rememberDays: number = 30
  ): Promise<{ success: boolean; error?: string }> {
    const check = await this.verifyCredentials(username, password, rememberDays);
    if (!check.success) {
      return check;
    }
    isAppAuthenticated.set(true);
    return { success: true };
  }

  public async login(
    username: string,
    password: string
  ): Promise<{ success: boolean; error?: string }> {
    const check = await this.verifyCredentials(username, password, 30);
    if (!check.success) {
      return check;
    }
    isManagerUnlocked.set(true);
    return { success: true };
  }

  /**
   * Changes the offline cache password ONLY if a verified record already exists
   * and the current password matches in constant time.
   */
  public async changePassword(
    currentPassword: string,
    newPassword: string,
    newUsername?: string
  ): Promise<{ success: boolean; error?: string }> {
    if (!currentPassword) {
      return {
        success: false,
        error: 'وارد کردن رمز عبور فعلی الزامی است.'
      };
    }
    if (!newPassword || newPassword.length < 8) {
      return {
        success: false,
        error: 'رمز عبور جدید باید حداقل ۸ کاراکتر باشد.'
      };
    }

    const record = await this.getRecord();
    if (!record || !record.passwordHash || !record.salt) {
      return {
        success: false,
        error:
          'هیچ حساب تأییدشده‌ای در حافظه محلی وجود ندارد. لطفاً ابتدا به صورت آنلاین وارد شوید.'
      };
    }

    const currentHash = deriveLocalPasswordHash(currentPassword, record.salt);
    if (!constantTimeHashCompare(currentHash, record.passwordHash)) {
      return { success: false, error: 'رمز عبور فعلی نادرست است.' };
    }

    const finalUser = newUsername?.trim() || record.username;
    if (!finalUser) {
      return { success: false, error: 'نام کاربری نمی‌تواند خالی باشد.' };
    }

    await this.saveVerifiedLocalCache(finalUser, newPassword);
    activeManagerUsername.set(finalUser);
    return { success: true };
  }

  public lock(): void {
    isManagerUnlocked.set(false);
  }

  public logoutWholeApp(): void {
    const token = getActiveSessionToken();
    if (token && typeof fetch !== 'undefined') {
      void fetch('/api/auth/logout', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`
        },
        credentials: 'same-origin'
      }).catch(() => {});
    }
    clearStoredSession();
    isManagerUnlocked.set(false);
    isAppAuthenticated.set(false);
  }
}

export const managerAuthService = new ManagerAuthService();
