import type {
  CachedProvisioningSchema,
  ProvisioningBookmark,
  ProvisioningSchema,
} from '../../domain/provisioning';
import { openRetivumDatabase, requestResult, transactionDone } from './database';

const maximumCachedSchemas = 5;

export class BrowserProvisioningRepository {
  async loadBookmarks(): Promise<ProvisioningBookmark[]> {
    const database = await openRetivumDatabase();
    try {
      const transaction = database.transaction('provisioningBookmarks', 'readonly');
      const bookmarks = await requestResult<ProvisioningBookmark[]>(
        transaction.objectStore('provisioningBookmarks').getAll(),
      );
      await transactionDone(transaction);
      return bookmarks.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    } finally {
      database.close();
    }
  }

  async saveBookmark(bookmark: ProvisioningBookmark): Promise<void> {
    const database = await openRetivumDatabase();
    try {
      const transaction = database.transaction('provisioningBookmarks', 'readwrite');
      transaction.objectStore('provisioningBookmarks').put(bookmark);
      await transactionDone(transaction);
    } finally {
      database.close();
    }
  }

  async deleteBookmark(id: string): Promise<boolean> {
    const database = await openRetivumDatabase();
    try {
      const transaction = database.transaction('provisioningBookmarks', 'readwrite');
      const store = transaction.objectStore('provisioningBookmarks');
      const existing = await requestResult<ProvisioningBookmark | undefined>(store.get(id));
      if (existing) store.delete(id);
      await transactionDone(transaction);
      return existing !== undefined;
    } finally {
      database.close();
    }
  }

  async loadSchema(schemaVersion: number, schemaHash: number): Promise<ProvisioningSchema | undefined> {
    const database = await openRetivumDatabase();
    try {
      const transaction = database.transaction('provisioningSchemas', 'readonly');
      const record = await requestResult<CachedProvisioningSchema | undefined>(
        transaction.objectStore('provisioningSchemas').get(schemaCacheId(schemaVersion, schemaHash)),
      );
      await transactionDone(transaction);
      return record?.schema;
    } finally {
      database.close();
    }
  }

  async saveSchema(schemaVersion: number, schemaHash: number, schema: ProvisioningSchema): Promise<void> {
    const database = await openRetivumDatabase();
    try {
      const transaction = database.transaction('provisioningSchemas', 'readwrite');
      const store = transaction.objectStore('provisioningSchemas');
      const records = await requestResult<CachedProvisioningSchema[]>(store.getAll());
      for (const record of records
        .filter((item) => item.id !== schemaCacheId(schemaVersion, schemaHash))
        .sort((left, right) => left.cachedAt.localeCompare(right.cachedAt))
        .slice(0, Math.max(0, records.length - maximumCachedSchemas + 1))) {
        store.delete(record.id);
      }
      store.put({
        id: schemaCacheId(schemaVersion, schemaHash),
        schemaVersion,
        schemaHash,
        schema,
        cachedAt: new Date().toISOString(),
      } satisfies CachedProvisioningSchema);
      await transactionDone(transaction);
    } finally {
      database.close();
    }
  }
}

function schemaCacheId(schemaVersion: number, schemaHash: number): string {
  return `${schemaVersion}:${schemaHash >>> 0}`;
}
