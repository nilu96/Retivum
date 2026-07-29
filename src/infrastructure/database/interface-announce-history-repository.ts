import {
  normalizeInterfaceAnnounceHistoryRecord,
  type InterfaceAnnounceHistoryRecord,
} from '../../domain/interface-announce';
import { openRetivumDatabase, requestResult, transactionDone } from './database';

export class BrowserInterfaceAnnounceHistoryRepository {
  async load(identityId: string): Promise<InterfaceAnnounceHistoryRecord[]> {
    const database = await openRetivumDatabase();
    try {
      const transaction = database.transaction('interfaceAnnounceHistory', 'readonly');
      const records = await requestResult<unknown[]>(
        transaction.objectStore('interfaceAnnounceHistory').index('identityId').getAll(identityId),
      );
      await transactionDone(transaction);
      return records.flatMap((value) => {
        const normalized = normalizeInterfaceAnnounceHistoryRecord(value);
        return normalized ? [normalized] : [];
      });
    } finally {
      database.close();
    }
  }

  async save(records: InterfaceAnnounceHistoryRecord[]): Promise<void> {
    const normalized = records.flatMap((value) => {
      const record = normalizeInterfaceAnnounceHistoryRecord(value);
      return record ? [record] : [];
    });
    if (normalized.length === 0) return;
    const database = await openRetivumDatabase();
    try {
      const transaction = database.transaction('interfaceAnnounceHistory', 'readwrite');
      const store = transaction.objectStore('interfaceAnnounceHistory');
      for (const record of normalized) store.put(structuredClone(record));
      await transactionDone(transaction);
    } finally {
      database.close();
    }
  }
}
