import { writable } from 'svelte/store';
import { dbClient, requestToPromise } from './db';
import type { ManagerAuthRecord } from '../models/types';

const MANAGER_AUTH_KEY = 'manager_credentials';
const SESSION_TOKEN_STORAGE_KEY = 'gk_session_token';
const SESSION_CSRF_STORAGE_KEY = 'gk_session_csrf';
const SESSION_USER_STORAGE_KEY = 'gk_session_user';
const SESSION_EXPIRES_STORAGE_KEY = 'gk_session_expires';

const CONNECTION_MODE_KEY = 'gk_operating_mode';
const SERVER_URL_STORAGE_KEY = 'gk_server_address';

const PBKDF2_ITERATIONS = 100000;
const PBKDF2_FALLBACK_ITERATIONS = 20000;

export type OperatingMode = 'unconfigured' | 'standalone' | 'server';

export function getOperatingMode(): OperatingMode {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return 'standalone';
  }
  const raw = localStorage.getItem(CONNECTION_MODE_KEY);
  if (raw === 'standalone' || raw === 'server') {
    return raw;
  }
  return 'unconfigured';
}

export function getConfiguredServerUrl(): string {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return '';
  }
  return (localStorage.getItem(SERVER_URL_STORAGE_KEY) || '')
    .trim()
    .replace(/\/+$/, '');
}

export function setConnectionConfig(
  mode: OperatingMode,
  serverUrl: string = ''
): void {
  const cleanUrl = serverUrl.trim().replace(/\/+$/, '');
  if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(CONNECTION_MODE_KEY, mode);
      localStorage.setItem(SERVER_URL_STORAGE_KEY, cleanUrl);
    } catch {
      // Ignore storage errors
    }
  }
  operatingModeStore.set(mode);
  configuredServerUrlStore.set(cleanUrl);
}

export const operatingModeStore = writable<OperatingMode>(getOperatingMode());
export const configuredServerUrlStore = writable<string>(getConfiguredServerUrl());

function purgeLegacyCookies(): void {
  if (typeof document !== 'undefined') {
    document.cookie = 'gk_app_auth=; path=/; max-age=0; SameSite=Strict';
  }
}

interface StoredClientSessionMeta {
  token: string;
  csrfToken: string;
  username: string;
  expiresAt: number;
}

function readStoredSessionMeta(): StoredClientSessionMeta | null {
  purgeLegacyCookies();
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return null;
  }
  try {
    const token = localStorage.getItem(SESSION_TOKEN_STORAGE_KEY) || '';
    const csrfToken = localStorage.getItem(SESSION_CSRF_STORAGE_KEY) || '';
    const username = localStorage.getItem(SESSION_USER_STORAGE_KEY) || '';
    const expiresAt = Number(localStorage.getItem(SESSION_EXPIRES_STORAGE_KEY) || '0');
    if (
      !/^[a-f0-9]{64}$/i.test(csrfToken) ||
      !username ||
      (expiresAt > 0 && expiresAt <= Date.now())
    ) {
      clearStoredSessionMeta();
      return null;
    }
    return { token, csrfToken, username, expiresAt };
  } catch {
    return null;
  }
}

function saveStoredSessionMeta(
  token: string,
  csrfToken: string,
  username: string,
  expiresAt: number
): void {
  purgeLegacyCookies();
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return;
  }
  try {
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, token);
    localStorage.setItem(SESSION_CSRF_STORAGE_KEY, csrfToken);
    localStorage.setItem(SESSION_USER_STORAGE_KEY, username);
    localStorage.setItem(SESSION_EXPIRES_STORAGE_KEY, String(expiresAt));
  } catch {
    // Ignore storage quota errors
  }
}

function clearStoredSessionMeta(): void {
  purgeLegacyCookies();
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return;
  }
  try {
    localStorage.removeItem(SESSION_TOKEN_STORAGE_KEY);
    localStorage.removeItem(SESSION_CSRF_STORAGE_KEY);
    localStorage.removeItem(SESSION_USER_STORAGE_KEY);
    localStorage.removeItem(SESSION_EXPIRES_STORAGE_KEY);
  } catch {
    // Ignore
  }
}

export function getActiveSessionToken(): string {
  const meta = readStoredSessionMeta();
  return meta ? meta.token : '';
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
    throw new Error('Secure random number generator (crypto.getRandomValues) is required.');
  }
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function constantTimeStringCompare(a: string, b: string): boolean {
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

// ============================================================================
// Standard FIPS 180-4 SHA-256 & RFC 2898 PBKDF2-HMAC-SHA256
// ============================================================================

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);

function rotr32(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

function sha256Bytes(data: Uint8Array): Uint8Array {
  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const bitLen = data.length * 8;
  const padLen = (data.length + 9 + 63) & ~63;
  const padded = new Uint8Array(padLen);
  padded.set(data);
  padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padLen - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(padLen - 4, bitLen >>> 0, false);

  const w = new Uint32Array(64);
  for (let offset = 0; offset < padLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr32(w[i - 15], 7) ^ rotr32(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr32(w[i - 2], 17) ^ rotr32(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, h0, false);
  outView.setUint32(4, h1, false);
  outView.setUint32(8, h2, false);
  outView.setUint32(12, h3, false);
  outView.setUint32(16, h4, false);
  outView.setUint32(20, h5, false);
  outView.setUint32(24, h6, false);
  outView.setUint32(28, h7, false);
  return out;
}

function hmacSha256Bytes(key: Uint8Array, message: Uint8Array): Uint8Array {
  const blockSize = 64;
  const k = key.length > blockSize ? sha256Bytes(key) : key;
  const ipad = new Uint8Array(blockSize + message.length);
  const opad = new Uint8Array(blockSize + 32);

  for (let i = 0; i < blockSize; i++) {
    const kb = i < k.length ? k[i] : 0;
    ipad[i] = kb ^ 0x36;
    opad[i] = kb ^ 0x5c;
  }
  ipad.set(message, blockSize);
  const innerHash = sha256Bytes(ipad);
  opad.set(innerHash, blockSize);
  return sha256Bytes(opad);
}

export function pbkdf2HmacSha256Sync(
  password: string,
  salt: string,
  iterations = PBKDF2_FALLBACK_ITERATIONS
): string {
  const enc = new TextEncoder();
  const keyBytes = enc.encode(password);
  const saltBytes = enc.encode(salt);

  const saltBlock = new Uint8Array(saltBytes.length + 4);
  saltBlock.set(saltBytes);
  saltBlock[saltBytes.length] = 0;
  saltBlock[saltBytes.length + 1] = 0;
  saltBlock[saltBytes.length + 2] = 0;
  saltBlock[saltBytes.length + 3] = 1;

  let u = hmacSha256Bytes(keyBytes, saltBlock);
  const t = new Uint8Array(u);

  for (let c = 1; c < iterations; c++) {
    u = hmacSha256Bytes(keyBytes, u);
    for (let j = 0; j < 32; j++) {
      t[j] ^= u[j];
    }
  }

  return Array.from(t)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function deriveSaltedPasswordHashAsync(
  password: string,
  saltHex: string,
  iterations = PBKDF2_ITERATIONS
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
          iterations,
          hash: 'SHA-256'
        },
        keyMaterial,
        256
      );
      const hashHex = Array.from(new Uint8Array(derivedBits))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      return `pbkdf2$${iterations}$${hashHex}`;
    } catch {
      // Fall through to synchronous PBKDF2-HMAC-SHA256
    }
  }
  const syncIterations = Math.min(iterations, PBKDF2_FALLBACK_ITERATIONS);
  const hashHex = pbkdf2HmacSha256Sync(password, saltHex, syncIterations);
  return `pbkdf2$${syncIterations}$${hashHex}`;
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
    const passwordHash = await deriveSaltedPasswordHashAsync(
      password,
      salt,
      PBKDF2_ITERATIONS
    );
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
    const parts = record.passwordHash.split('$');
    if (parts.length !== 3 || parts[0] !== 'pbkdf2') {
      return false;
    }
    const iterations = Number(parts[1]);
    if (!Number.isInteger(iterations) || iterations < 10000 || iterations > 1000000) {
      return false;
    }
    const candidate = await deriveSaltedPasswordHashAsync(
      password,
      record.salt,
      iterations
    );
    return constantTimeStringCompare(candidate, record.passwordHash);
  }

  /**
   * Initializes a Standalone (offline-first on-device) Manager account when the user
   * chooses "حالت مستقل روی همین گوشی" on first launch.
   */
  public async setupStandaloneAccount(
    username: string,
    password: string,
    rememberDays: number = 30
  ): Promise<{ success: boolean; error?: string }> {
    const cleanUser = username.trim();
    if (!cleanUser) {
      return { success: false, error: 'لطفاً نام کاربری دلخواه خود را وارد کنید.' };
    }
    if (!password || password.length < 8) {
      return {
        success: false,
        error: 'رمز عبور باید حداقل ۸ کاراکتر باشد.'
      };
    }

    await this.saveVerifiedLocalCache(cleanUser, password);
    setConnectionConfig('standalone', '');

    const localCsrf = generateRandomSaltHex(32);
    const expiresAt = Date.now() + rememberDays * 24 * 60 * 60 * 1000;
    saveStoredSessionMeta('', localCsrf, cleanUser, expiresAt);

    activeManagerUsername.set(cleanUser);
    isManagerConfigured.set(true);
    isAppAuthenticated.set(true);
    return { success: true };
  }

  public async checkInitialized(): Promise<boolean> {
    purgeLegacyCookies();
    const mode = getOperatingMode();
    const serverUrl = getConfiguredServerUrl();
    const storedMeta = readStoredSessionMeta();

    if (storedMeta) {
      isAppAuthenticated.set(true);
      activeManagerUsername.set(storedMeta.username);

      if (mode === 'server' && typeof fetch !== 'undefined') {
        const endpoint = `${serverUrl}/api/auth/session`;
        const headers: Record<string, string> = {
          Accept: 'application/json',
          'X-Requested-With': 'XMLHttpRequest'
        };
        if (storedMeta.token) {
          headers['Authorization'] = `Bearer ${storedMeta.token}`;
        }
        try {
          const res = await fetch(endpoint, {
            method: 'GET',
            headers,
            credentials: serverUrl ? 'include' : 'same-origin'
          });
          if (res.status === 401 || res.status === 403) {
            this.logoutWholeApp();
            return false;
          }
          if (res.ok) {
            const data = await res.json().catch(() => null);
            if (data && typeof data.csrfToken === 'string') {
              saveStoredSessionMeta(
                storedMeta.token,
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
    if (rec && rec.username && rec.passwordHash?.startsWith('pbkdf2$')) {
      if (!storedMeta) {
        activeManagerUsername.set(rec.username);
      }
      isManagerConfigured.set(true);
      if (mode === 'unconfigured') {
        setConnectionConfig('standalone', '');
      }
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

    const mode = getOperatingMode();
    const serverUrl = getConfiguredServerUrl();

    // 1. If in Server Mode (or web with relative /api), verify against the server first
    if (mode !== 'standalone' && typeof fetch !== 'undefined') {
      const loginUrl = `${serverUrl}/api/auth/login`;
      try {
        const res = await fetch(loginUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'X-Requested-With': 'XMLHttpRequest'
          },
          credentials: serverUrl ? 'include' : 'same-origin',
          body: JSON.stringify({
            username: cleanUser,
            password,
            rememberDays
          })
        });

        const data = await res.json().catch(() => null);

        if (res.ok && data && data.ok && typeof data.csrfToken === 'string') {
          const verifiedUser = String(data.username || cleanUser);
          const signedToken = typeof data.token === 'string' ? data.token : '';
          const expiresAt =
            Number(data.expiresAt) ||
            Date.now() + rememberDays * 24 * 60 * 60 * 1000;

          saveStoredSessionMeta(signedToken, data.csrfToken, verifiedUser, expiresAt);
          await this.saveVerifiedLocalCache(verifiedUser, password);
          activeManagerUsername.set(verifiedUser);
          isManagerConfigured.set(true);
          if (mode === 'unconfigured') {
            setConnectionConfig('server', serverUrl);
          }
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
        // Network unreachable: proceed to strict local PBKDF2 verification below
      }
    }

    // 2. Verify against local PBKDF2-HMAC-SHA256 record (Standalone Mode or Offline Cache)
    const record = await this.getRecord();
    if (
      !record ||
      !record.username ||
      !record.passwordHash ||
      !record.passwordHash.startsWith('pbkdf2$') ||
      !record.salt
    ) {
      return {
        success: false,
        error:
          mode === 'server'
            ? 'ارتباط با سرور برقرار نیست. آدرس سرور یا اتصال اینترنت را بررسی کنید.'
            : 'ابتدا حساب کاربری را راه‌اندازی کنید.'
      };
    }

    const userMatches =
      cleanUser.toLowerCase() === record.username.trim().toLowerCase();
    const hashMatches = await this.verifyAgainstLocalRecord(record, password);

    if (userMatches && hashMatches) {
      if (mode === 'standalone' && !hasActiveSessionMeta()) {
        const localCsrf = generateRandomSaltHex(32);
        const expiresAt = Date.now() + rememberDays * 24 * 60 * 60 * 1000;
        saveStoredSessionMeta('', localCsrf, record.username, expiresAt);
      }
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
        error: 'هیچ حساب تأییدشده‌ای در حافظه محلی وجود ندارد.'
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
    const token = getActiveSessionToken();
    const serverUrl = getConfiguredServerUrl();
    const mode = getOperatingMode();

    if (mode === 'server' && csrfToken && typeof fetch !== 'undefined') {
      const headers: Record<string, string> = {
        'X-CSRF-Token': csrfToken,
        'X-Requested-With': 'XMLHttpRequest'
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      void fetch(`${serverUrl}/api/auth/logout`, {
        method: 'POST',
        headers,
        credentials: serverUrl ? 'include' : 'same-origin'
      }).catch(() => {});
    }
    clearStoredSessionMeta();
    isManagerUnlocked.set(false);
    isAppAuthenticated.set(false);
  }
}

export const managerAuthService = new ManagerAuthService();
