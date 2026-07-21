import type { CachedProvisioningSchema, ProvisioningNode, ProvisioningSchema } from '../../domain/provisioning';
import { openRetivumDatabase, requestResult, transactionDone } from './database';

const maximumCachedSchemas = 5;

export class BrowserProvisioningRepository {
  async loadNodes(): Promise<ProvisioningNode[]> {
    const database = await openRetivumDatabase();
    try {
      const transaction = database.transaction('provisioningNodes', 'readonly');
      const nodes = await requestResult<ProvisioningNode[]>(transaction.objectStore('provisioningNodes').getAll());
      await transactionDone(transaction);
      return nodes.sort((left, right) => right.heardAt.localeCompare(left.heardAt));
    } finally {
      database.close();
    }
  }

  async saveNode(node: ProvisioningNode): Promise<void> {
    const database = await openRetivumDatabase();
    try {
      const transaction = database.transaction('provisioningNodes', 'readwrite');
      transaction.objectStore('provisioningNodes').put(node);
      await transactionDone(transaction);
    } finally {
      database.close();
    }
  }

  async setNodeBookmarked(id: string, bookmarked: boolean): Promise<ProvisioningNode | undefined> {
    const database = await openRetivumDatabase();
    try {
      const transaction = database.transaction('provisioningNodes', 'readwrite');
      const store = transaction.objectStore('provisioningNodes');
      const node = await requestResult<ProvisioningNode | undefined>(store.get(id));
      if (!node) {
        await transactionDone(transaction);
        return undefined;
      }
      const updated = { ...node, bookmarked };
      store.put(updated);
      await transactionDone(transaction);
      return updated;
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
