import type { AppPreferences, InterfaceConfig } from '../../domain/settings';
import { normalizeAppPreferences, normalizeInterfaceConfig } from '../../domain/settings';
import { openRetivumDatabase, requestResult, transactionDone } from './database';

export interface SettingsSnapshot {
  preferences: AppPreferences;
  interfaces: InterfaceConfig[];
}

export interface SettingsRepository {
  load(): Promise<SettingsSnapshot>;
  savePreferences(preferences: AppPreferences): Promise<void>;
  saveInterface(config: InterfaceConfig): Promise<void>;
  deleteInterface(id: string): Promise<void>;
}

export class BrowserSettingsRepository implements SettingsRepository {
  async load(): Promise<SettingsSnapshot> {
    const database = await openRetivumDatabase();
    try {
      const transaction = database.transaction(['settings', 'interfaces'], 'readonly');
      const preferencesRequest = transaction.objectStore('settings').get('app');
      const interfacesRequest = transaction.objectStore('interfaces').getAll();
      const [preferences, interfaces] = await Promise.all([
        requestResult<AppPreferences | undefined>(preferencesRequest),
        requestResult<unknown[]>(interfacesRequest),
        transactionDone(transaction),
      ]);

      return {
        preferences: normalizeAppPreferences(preferences),
        interfaces: interfaces.flatMap((item) => {
          const normalized = normalizeInterfaceConfig(item);
          return normalized ? [normalized] : [];
        }),
      };
    } finally {
      database.close();
    }
  }

  async savePreferences(preferences: AppPreferences): Promise<void> {
    const database = await openRetivumDatabase();
    try {
      const transaction = database.transaction('settings', 'readwrite');
      transaction.objectStore('settings').put(structuredClone(preferences), 'app');
      await transactionDone(transaction);
    } finally {
      database.close();
    }
  }

  async saveInterface(config: InterfaceConfig): Promise<void> {
    const database = await openRetivumDatabase();
    try {
      const transaction = database.transaction('interfaces', 'readwrite');
      transaction.objectStore('interfaces').put(structuredClone(config));
      await transactionDone(transaction);
    } finally {
      database.close();
    }
  }

  async deleteInterface(id: string): Promise<void> {
    const database = await openRetivumDatabase();
    try {
      const transaction = database.transaction('interfaces', 'readwrite');
      transaction.objectStore('interfaces').delete(id);
      await transactionDone(transaction);
    } finally {
      database.close();
    }
  }
}
