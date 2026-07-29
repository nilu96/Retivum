import {
  normalizeKnownDestination,
  type KnownDestinationRecord,
} from '../../domain/known-destination';
import { openRetivumDatabase, requestResult, transactionDone } from './database';

export class BrowserKnownDestinationRepository {
  async loadAll(): Promise<KnownDestinationRecord[]> {
    const database = await openRetivumDatabase();
    try {
      const transaction = database.transaction('knownDestinations', 'readonly');
      const stored = await requestResult<KnownDestinationRecord[]>(
        transaction.objectStore('knownDestinations').getAll(),
      );
      await transactionDone(transaction);
      return stored.flatMap((record) => {
        const normalized = normalizeKnownDestination(record);
        return normalized ? [normalized] : [];
      });
    } finally {
      database.close();
    }
  }

  async save(record: KnownDestinationRecord): Promise<void> {
    const normalized = normalizeKnownDestination(record);
    if (!normalized) throw new Error('KNOWN_DESTINATION_INVALID');
    const database = await openRetivumDatabase();
    try {
      const transaction = database.transaction('knownDestinations', 'readwrite');
      transaction.objectStore('knownDestinations').put(normalized);
      await transactionDone(transaction);
    } finally {
      database.close();
    }
  }

  async deleteMany(destinationHashes: readonly string[]): Promise<void> {
    const normalized = Array.from(new Set(destinationHashes.flatMap((value) => {
      const destinationHash = value.trim().toLowerCase();
      return /^[0-9a-f]{32}$/.test(destinationHash) ? [destinationHash] : [];
    })));
    if (normalized.length === 0) return;
    const database = await openRetivumDatabase();
    try {
      const transaction = database.transaction('knownDestinations', 'readwrite');
      const store = transaction.objectStore('knownDestinations');
      for (const destinationHash of normalized) store.delete(destinationHash);
      await transactionDone(transaction);
    } finally {
      database.close();
    }
  }

  async delete(destinationHash: string): Promise<void> {
    await this.deleteMany([destinationHash]);
  }

  async clear(): Promise<void> {
    const database = await openRetivumDatabase();
    try {
      const transaction = database.transaction('knownDestinations', 'readwrite');
      transaction.objectStore('knownDestinations').clear();
      await transactionDone(transaction);
    } finally {
      database.close();
    }
  }
}
