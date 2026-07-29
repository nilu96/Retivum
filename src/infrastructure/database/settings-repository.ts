import type { AppPreferences, InterfaceConfig } from '../../domain/settings';
import {
  normalizeAppPreferences,
  normalizeInterfaceConfig,
  sortInterfaceConfigurations,
} from '../../domain/settings';
import { interfaceNetworkFingerprint } from '../../domain/interface-announce';
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
        interfaces: sortInterfaceConfigurations(interfaces.flatMap((item) => {
          const normalized = normalizeInterfaceConfig(item);
          return normalized ? [normalized] : [];
        })),
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
      const transaction = database.transaction(
        ['interfaces', 'interfaceAnnounceHistory'],
        'readwrite',
      );
      const interfaceStore = transaction.objectStore('interfaces');
      const existing = normalizeInterfaceConfig(
        await requestResult<unknown>(interfaceStore.get(config.id)),
      );
      const normalized = normalizeInterfaceConfig(config);
      if (!normalized) throw new Error('INTERFACE_CONFIG_INVALID');
      const stored: InterfaceConfig = {
        ...normalized,
        createdAt: existing?.createdAt ?? normalized.createdAt,
      };
      interfaceStore.put(structuredClone(stored));
      const historyStore = transaction.objectStore('interfaceAnnounceHistory');
      const historyRecords = await requestResult<unknown[]>(
        historyStore.index('interfaceId').getAll(config.id),
      );
      const networkFingerprint = interfaceNetworkFingerprint(stored);
      for (const value of historyRecords) {
        if (!value || typeof value !== 'object') continue;
        const record = value as { id?: unknown; networkFingerprint?: unknown };
        if (
          record.networkFingerprint !== networkFingerprint
          && typeof record.id === 'string'
        ) historyStore.delete(record.id);
      }
      await transactionDone(transaction);
    } finally {
      database.close();
    }
  }

  async deleteInterface(id: string): Promise<void> {
    const database = await openRetivumDatabase();
    try {
      const transaction = database.transaction(
        ['interfaces', 'interfaceAnnounceHistory'],
        'readwrite',
      );
      transaction.objectStore('interfaces').delete(id);
      const historyStore = transaction.objectStore('interfaceAnnounceHistory');
      const historyKeys = await requestResult<IDBValidKey[]>(
        historyStore.index('interfaceId').getAllKeys(id),
      );
      for (const key of historyKeys) historyStore.delete(key);
      await transactionDone(transaction);
    } finally {
      database.close();
    }
  }
}
