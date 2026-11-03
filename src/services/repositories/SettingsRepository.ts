import { dbClient, requestToPromise } from '../db';
import type { ApplicationSettings } from '../../models/types';

export const SETTINGS_KEY = 'global_app_settings';

export const DEFAULT_SETTINGS: ApplicationSettings = {
  serverAddress: '',
  defaultUnit: 'کیلوگرم',
  currency: 'IRT',
  lastSyncAt: null
};

export class SettingsRepository {
  public async getSettings(): Promise<ApplicationSettings> {
    try {
      return await dbClient.executeTransaction(
        'settings',
        'readonly',
        async (stores) => {
          const record = await requestToPromise(stores['settings'].get(SETTINGS_KEY));
          if (record && record.value) {
            return { ...DEFAULT_SETTINGS, ...record.value };
          }
          return { ...DEFAULT_SETTINGS };
        }
      );
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  public async saveSettings(
    settings: Partial<ApplicationSettings>
  ): Promise<ApplicationSettings> {
    const current = await this.getSettings();
    const updated: ApplicationSettings = { ...current, ...settings, currency: 'IRT' };

    await dbClient.executeTransaction('settings', 'readwrite', async (stores) => {
      await requestToPromise(
        stores['settings'].put({ key: SETTINGS_KEY, value: updated })
      );
    });

    return updated;
  }
}

export const settingsRepository = new SettingsRepository();
