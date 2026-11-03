import { dbClient } from '../db';
import type { ApplicationSettings } from '../../models/types';

const SETTINGS_KEY = 'global_app_settings';

const DEFAULT_SETTINGS: ApplicationSettings = {
  serverAddress: '',
  defaultUnit: 'کیلوگرم',
  currency: 'IRT',
  lastSyncAt: null
};

export class SettingsRepository {
  public async getSettings(): Promise<ApplicationSettings> {
    return dbClient.executeTransaction('settings', 'readonly', async (stores) => {
      const store = stores['settings'];
      return new Promise<ApplicationSettings>((resolve) => {
        const req = store.get(SETTINGS_KEY);
        req.onsuccess = () => {
          if (req.result && req.result.value) {
            resolve({ ...DEFAULT_SETTINGS, ...req.result.value });
          } else {
            resolve(DEFAULT_SETTINGS);
          }
        };
        req.onerror = () => resolve(DEFAULT_SETTINGS);
      });
    });
  }

  public async saveSettings(settings: Partial<ApplicationSettings>): Promise<ApplicationSettings> {
    const current = await this.getSettings();
    const updated: ApplicationSettings = { ...current, ...settings };

    await dbClient.executeTransaction('settings', 'readwrite', async (stores) => {
      const store = stores['settings'];
      return new Promise<void>((resolve, reject) => {
        const req = store.put({ key: SETTINGS_KEY, value: updated });
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    });

    return updated;
  }
}

export const settingsRepository = new SettingsRepository();
