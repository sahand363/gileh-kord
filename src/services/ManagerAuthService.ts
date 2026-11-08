import { writable } from 'svelte/store';
import { dbClient, requestToPromise } from './db';
import type { ManagerAuthRecord } from '../models/types';

const MANAGER_AUTH_KEY = 'manager_credentials';
const LEGACY_TOKEN_STORAGE_KEY = 'gk_session_token';
const SESSION_CSRF_STORAGE_KEY = 'gk_session_csrf';
const SESSION_USER_STORAGE_KEY = 'gk_session_user';
const SESSION_EXPIRES_STORAGE_KEY = 'gk_session_expires';

function purgeLegacyTokensAndCookies(): void {
  if (typeof document !== 'undefined') {
    document.cookie = 'gk_app_auth=; path=/; max-age=0; SameSite=Lax';
  }
  if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem(LEGACY_TOKEN_STORAGE_KEY);
    } catch {
      // Ignore
    }
  }
}

interface StoredClientSessionMeta {
  csrfToken: string;
  username: string;
  expiresAt: number;
}

function readStoredSessionMeta(): StoredClientSessionMeta | null {
  purgeLegacyTokensAndCookies();
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return null;
  }
  try {
    const csrfToken = localStorage.getItem(SESSION_CSRF_STORAGE_KEY) || '';
    const username = localStorage.getItem(SESSION_USER_STORAGE_KEY) || '';
    const expiresAt = Number(localStorage.getItem(SESSION_EXPIRES_STORAGE_KEY) || '0');
    if (!csrfToken || !username || (expiresAt > 0 && expiresAt <= Date.now())) {
      clearStoredSessionMeta();
      return null;
    }
    return { csrfToken, username, expiresAt };
  } catch {
    return null;
  }
}

function saveStoredSessionMeta(
  csrfToken: string,
  username: string,
  expiresAt: number
): void {
  purgeLegacyTokensAndCookies();
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return;
  }
  try {
    localStorage.setItem(SESSION_CSRF_STORAGE_KEY, csrfToken);
    localStorage.setItem(SESSION_USER_STORAGE_KEY, username);
    localStorage.setItem(SESSION_EXPIRES_STORAGE_KEY, String(expiresAt));
  } catch {
    // Ignore storage quota errors
  }
}

function clearStoredSessionMeta(): void {
  purgeLegacyTokensAndCookies();
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return;
  }
  try {
    localStorage.removeItem(SESSION_CSRF_STORAGE_KEY);
    localStorage.removeItem(SESSION_USER_STORAGE_KEY);
    localStorage.removeItem(SESSION_EXPIRES_STORAGE_KEY);
  } catch {
    // Ignore
  }
}

export function getActiveCsrfToken(): string {
  const meta = readStoredSessionMeta();
  return meta ? meta.csrfToken : '';
}

export function hasActiveSessionMeta(): boolean {
  return Boolean(readStoredSessionMeta());
}

function generateRandomSaltHex(byteLength = 16): string {
  const bytes = new Uint8Array(byteLength);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < byteLength; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function constantTimeHexCompare(a: string, b: string): boolean {
  if (
    typeof a !== 'string' ||
    typeof b !== 'string' ||
    a.length !== b.length ||
    a.length === 0
  ) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function deriveSaltedPasswordHashAsync(
  password: string,
  saltHex: string
): Promise<string> {
  if (
    typeof crypto !== 'undefined' &&
    crypto.subtle &&
    typeof TextEncoder !== 'undefined'
  ) {
    try {
      const enc = new TextEncoder();
      const keyMaterial = await crypto.subtle.importKey(
        'raw',
        enc.encode(password),
        { name: 'PBKDF2' },
        false,
        ['deriveBits']
      );
      const derivedBits = await crypto.subtle.deriveBits(
        {
          name: 'PBKDF2',
          salt: enc.encode(saltHex),
          iterations: 100000,
          hash: 'SHA-256'
        },
        keyMaterial,
        256
      );
      const hashArray = Array.from(new Uint8Array(derivedBits));
      const hashHex = hashArray
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      return `pbkdf2$100000$${hashHex}`;
    } catch {
      // Fallback below if SubtleCrypto is unavailable in HTTP context
    }
  }
  return `kdf2$${deriveLocalPasswordHash(password, saltHex)}`;
}

export function deriveLocalPasswordHash(password: string, salt: string): string {
  const input = `${salt}::gileh_kord_v2_salted::${password}`;
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

  for (let round = 0; round < 16384; round++) {
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

const initialMeta = readStoredSessionMeta();

export const isAppAuthenticated = writable<boolean>(Boolean(initialMeta));
export const isManagerUnlocked = writable<boolean>(false);
export const isManagerConfigured = writable<boolean>(false);
export const activeManagerUsername = writable<string>(
  initialMeta ? initialMeta.username : ''
);

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
    const salt = generateRandomSaltHex(16);
    const passwordHash = await deriveSaltedPasswordHashAsync(password, salt);
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

  private async verifyAgainstLocalRecord(
    record: ManagerAuthRecord,
    password: string
  ): Promise<boolean> {
    if (!record.salt || !record.passwordHash) return false;
    if (record.passwordHash.startsWith('pbkdf2$')) {
      const candidate = await deriveSaltedPasswordHashAsync(password, record.salt);
      return constantTimeHexCompare(candidate, record.passwordHash);
    }
    if (record.passwordHash.startsWith('kdf2$')) {
      const candidate = `kdf2$${deriveLocalPasswordHash(password, record.salt)}`;
      return constantTimeHexCompare(candidate, record.passwordHash);
    }
    const legacyCandidate = deriveLocalPasswordHash(password, record.salt);
    return constantTimeHexCompare(legacyCandidate, record.passwordHash);
  }

  public async checkInitialized(): Promise<boolean> {
    purgeLegacyTokensAndCookies();
    const storedMeta = readStoredSessionMeta();
    if (storedMeta) {
      isAppAuthenticated.set(true);
      activeManagerUsername.set(storedMeta.username);

      if (typeof fetch !== 'undefined') {
        try {
          const res = await fetch('/api/auth/session', {
            method: 'GET',
            headers: {
              Accept: 'application/json',
              'X-Requested-With': 'XMLHttpRequest'
            },
            credentials: 'same-origin'
          });
          if (res.status === 401) {
            this.logoutWholeApp();
            return false;
          }
          if (res.ok) {
            const data = await res.json().catch(() => null);
            if (data && typeof data.csrfToken === 'string') {
              saveStoredSessionMeta(
                data.csrfToken,
                String(data.username || storedMeta.username),
                Number(data.expiresAt || storedMeta.expiresAt)
              );
            }
          }
        } catch {
          // Offline: retain locally verified session metadata until expiry
        }
      }
    } else {
      isAppAuthenticated.set(false);
    }

    const rec = await this.getRecord();
    if (rec && rec.username) {
      if (!storedMeta) {
        activeManagerUsername.set(rec.username);
      }
      isManagerConfigured.set(true);
      return true;
    }

    isManagerConfigured.set(false);
    return false;
  }

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
            Accept: 'application/json',
            'X-Requested-With': 'XMLHttpRequest'
          },
          credentials: 'same-origin',
          body: JSON.stringify({
            username: cleanUser,
            password,
            rememberDays
          })
        });

        const data = await res.json().catch(() => null);

        if (
          res.ok &&
          data &&
          data.ok &&
          typeof data.csrfToken === 'string'
        ) {
          const verifiedUser = String(data.username || cleanUser);
          const expiresAt =
            Number(data.expiresAt) ||
            Date.now() + rememberDays * 24 * 60 * 60 * 1000;

          saveStoredSessionMeta(data.csrfToken, verifiedUser, expiresAt);
          await this.saveVerifiedLocalCache(verifiedUser, password);
          activeManagerUsername.set(verifiedUser);
          isManagerConfigured.set(true);
          return { success: true };
        }

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
    const hashMatches = await this.verifyAgainstLocalRecord(record, password);

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

    const matches = await this.verifyAgainstLocalRecord(record, currentPassword);
    if (!matches) {
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
    const csrfToken = getActiveCsrfToken();
    if (csrfToken && typeof fetch !== 'undefined') {
      void fetch('/api/auth/logout', {
        method: 'POST',
        headers: {
          'X-CSRF-Token': csrfToken,
          'X-Requested-With': 'XMLHttpRequest'
        },
        credentials: 'same-origin'
      }).catch(() => {});
    }
    clearStoredSessionMeta();
    isManagerUnlocked.set(false);
    isAppAuthenticated.set(false);
  }
}

export const managerAuthService = new ManagerAuthService();
