const databaseName = 'retivum';
const databaseVersion = 10;

export function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('DATABASE_REQUEST_FAILED'));
  });
}

export function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('DATABASE_TRANSACTION_FAILED'));
    transaction.onabort = () => reject(transaction.error ?? new Error('DATABASE_TRANSACTION_ABORTED'));
  });
}

export async function openRetivumDatabase(): Promise<IDBDatabase> {
  const request = indexedDB.open(databaseName, databaseVersion);
  request.onupgradeneeded = (event) => {
    const database = request.result;
    if (!database.objectStoreNames.contains('settings')) database.createObjectStore('settings');
    if (!database.objectStoreNames.contains('interfaces')) database.createObjectStore('interfaces', { keyPath: 'id' });
    if (!database.objectStoreNames.contains('secrets')) database.createObjectStore('secrets');
    if (!database.objectStoreNames.contains('identities')) database.createObjectStore('identities', { keyPath: 'id' });
    if (!database.objectStoreNames.contains('nomadAnnounces')) database.createObjectStore('nomadAnnounces', { keyPath: 'id' });
    if (!database.objectStoreNames.contains('nomadBookmarks')) database.createObjectStore('nomadBookmarks', { keyPath: 'id' });
    if (!database.objectStoreNames.contains('chatAnnounces')) database.createObjectStore('chatAnnounces', { keyPath: 'id' });
    if (!database.objectStoreNames.contains('chatMessages')) database.createObjectStore('chatMessages', { keyPath: 'id' });
    if (!database.objectStoreNames.contains('chatContacts')) database.createObjectStore('chatContacts', { keyPath: 'id' });
    if (!database.objectStoreNames.contains('chatBlockedDestinations')) {
      database.createObjectStore('chatBlockedDestinations', { keyPath: 'id' });
    }
    if (database.objectStoreNames.contains('propagationNodes')) database.deleteObjectStore('propagationNodes');
    if (!database.objectStoreNames.contains('networkState')) database.createObjectStore('networkState');
    if (!database.objectStoreNames.contains('provisioningNodes')) database.createObjectStore('provisioningNodes', { keyPath: 'id' });
    if (!database.objectStoreNames.contains('provisioningSchemas')) database.createObjectStore('provisioningSchemas', { keyPath: 'id' });
    if (event.oldVersion > 0 && event.oldVersion < 10) {
      migrateGlobalNomadAnnounces(request.transaction?.objectStore('nomadAnnounces'));
    }
  };
  return requestResult(request);
}

function migrateGlobalNomadAnnounces(store: IDBObjectStore | undefined): void {
  if (!store) return;
  const recordsRequest = store.getAll();
  recordsRequest.onsuccess = () => {
    const newestByDestination = new Map<string, Record<string, unknown>>();
    for (const value of recordsRequest.result) {
      if (!value || typeof value !== 'object') continue;
      const record = value as Record<string, unknown>;
      const destinationHash = typeof record.destinationHash === 'string'
        ? record.destinationHash.toLowerCase()
        : undefined;
      if (!destinationHash || !/^[0-9a-f]{32}$/.test(destinationHash)) continue;
      const previous = newestByDestination.get(destinationHash);
      const heardAt = typeof record.heardAt === 'string' ? record.heardAt : '';
      const previousHeardAt = typeof previous?.heardAt === 'string' ? previous.heardAt : '';
      if (previous && previousHeardAt > heardAt) continue;
      const { identityId: _identityId, ...globalRecord } = record;
      newestByDestination.set(destinationHash, {
        ...globalRecord,
        id: destinationHash,
        destinationHash,
      });
    }
    store.clear();
    for (const record of newestByDestination.values()) store.put(record);
  };
}
