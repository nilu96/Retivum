import type { PersistedNetworkStateRecord } from '../../domain/network-state';
import { openRetivumDatabase, requestResult, transactionDone } from './database';

const networkStateKey = 'reticulum-network-state:v1';

export class BrowserNetworkStateRepository {
  async load(): Promise<PersistedNetworkStateRecord | undefined> {
    const database = await openRetivumDatabase();
    try {
      const transaction = database.transaction('networkState', 'readonly');
      const value = await requestResult<PersistedNetworkStateRecord | undefined>(
        transaction.objectStore('networkState').get(networkStateKey),
      );
      await transactionDone(transaction);
      return value;
    } finally {
      database.close();
    }
  }

  async save(value: PersistedNetworkStateRecord): Promise<void> {
    const database = await openRetivumDatabase();
    try {
      const transaction = database.transaction('networkState', 'readwrite');
      transaction.objectStore('networkState').put(structuredClone(value), networkStateKey);
      await transactionDone(transaction);
    } finally {
      database.close();
    }
  }
}
