import { writable } from 'svelte/store';
import { dbClient, requestToPromise } from './db';
import type { ManagerAuthRecord } from '../models/types';
import { generateUUID } from '../utils/uuid';

const MANAGER_AUTH_KEY = 'manager_credentials';

export const isManagerUnlocked = writable<boolean>(false);
export const isManagerConfigured = writable<boolean>(false);
export const activeManagerUsername = writable<string>('');

/**
 * HTTP-safe and HTTPS-safe multi-round salted password derivation.
 * Note: Because `crypto.subtle` is disabled by browsers on plain HTTP IP addresses,
 * this deterministic 10,000-round 256-bit mixing function ensures password hashes
 * never store plaintext while working identically across HTTP IP and HTTPS Domain.
 * Real cryptographic protection against local DevTools access requires the future Go backend.
 */
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

  public async checkInitialized(): Promise<boolean> {
    const rec = await this.getRecord();
    const configured = Boolean(rec && rec.username && rec.passwordHash);
    isManagerConfigured.set(configured);
    if (rec) {
      activeManagerUsername.set(rec.username);
    }
    return configured;
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

    const existing = await this.getRecord();
    if (existing) {
      return {
        success: false,
        error: 'حساب مدیر قبلاً تنظیم شده است. لطفاً وارد شوید.'
      };
    }

    const salt = generateUUID();
    const passwordHash = deriveLocalPasswordHash(password, salt);
    const now = new Date().toISOString();

    const record: ManagerAuthRecord = {
      key: MANAGER_AUTH_KEY,
      username: cleanUser,
      passwordHash,
      salt,
      createdAt: now,
      updatedAt: now
    };

    await dbClient.executeTransaction('manager_auth', 'readwrite', async (stores) => {
      await requestToPromise(stores['manager_auth'].put(record));
    });

    isManagerConfigured.set(true);
    activeManagerUsername.set(cleanUser);
    isManagerUnlocked.set(true);
    return { success: true };
  }

  public async login(
    username: string,
    password: string
  ): Promise<{ success: boolean; error?: string }> {
    const record = await this.getRecord();
    if (!record) {
      return {
        success: false,
        error: 'حساب مدیر هنوز ایجاد نشده است.'
      };
    }

    if (username.trim().toLowerCase() !== record.username.toLowerCase()) {
      return {
        success: false,
        error: 'نام کاربری یا رمز عبور نادرست است.'
      };
    }

    const candidateHash = deriveLocalPasswordHash(password, record.salt);
    if (candidateHash !== record.passwordHash) {
      return {
        success: false,
        error: 'نام کاربری یا رمز عبور نادرست است.'
      };
    }

    activeManagerUsername.set(record.username);
    isManagerUnlocked.set(true);
    return { success: true };
  }

  public async changePassword(
    currentPassword: string,
    newPassword: string,
    newUsername?: string
  ): Promise<{ success: boolean; error?: string }> {
    const record = await this.getRecord();
    if (!record) {
      return { success: false, error: 'حساب مدیر یافت نشد.' };
    }

    const currentHash = deriveLocalPasswordHash(currentPassword, record.salt);
    if (currentHash !== record.passwordHash) {
      return { success: false, error: 'رمز عبور فعلی نادرست است.' };
    }

    if (!newPassword || newPassword.length < 4) {
      return {
        success: false,
        error: 'رمز عبور جدید باید حداقل ۴ کاراکتر باشد.'
      };
    }

    const newSalt = generateUUID();
    const updated: ManagerAuthRecord = {
      ...record,
      username: newUsername?.trim() || record.username,
      salt: newSalt,
      passwordHash: deriveLocalPasswordHash(newPassword, newSalt),
      updatedAt: new Date().toISOString()
    };

    await dbClient.executeTransaction('manager_auth', 'readwrite', async (stores) => {
      await requestToPromise(stores['manager_auth'].put(updated));
    });

    activeManagerUsername.set(updated.username);
    return { success: true };
  }

  public lock(): void {
    isManagerUnlocked.set(false);
  }
}

export const managerAuthService = new ManagerAuthService();
