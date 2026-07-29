import type { KnownDestinationRecord } from '../../domain/known-destination';
import type { ChatMessage } from '../../domain/chat';
import { assignChatMessageOrderings } from '../../domain/chat-ordering';
import { normalizeInterfaceConfig } from '../../domain/settings';

const databaseName = 'retivum';
const databaseVersion = 16;

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
    if (!database.objectStoreNames.contains('nomadBookmarks')) database.createObjectStore('nomadBookmarks', { keyPath: 'id' });
    if (!database.objectStoreNames.contains('chatMessages')) database.createObjectStore('chatMessages', { keyPath: 'id' });
    if (!database.objectStoreNames.contains('chatContacts')) database.createObjectStore('chatContacts', { keyPath: 'id' });
    if (!database.objectStoreNames.contains('chatBlockedDestinations')) {
      database.createObjectStore('chatBlockedDestinations', { keyPath: 'id' });
    }
    if (!database.objectStoreNames.contains('knownDestinations')) {
      database.createObjectStore('knownDestinations', { keyPath: 'destinationHash' });
    }
    if (!database.objectStoreNames.contains('networkState')) database.createObjectStore('networkState');
    if (!database.objectStoreNames.contains('provisioningBookmarks')) {
      database.createObjectStore('provisioningBookmarks', { keyPath: 'id' });
    }
    if (!database.objectStoreNames.contains('provisioningSchemas')) {
      database.createObjectStore('provisioningSchemas', { keyPath: 'id' });
    }
    if (!database.objectStoreNames.contains('interfaceAnnounceHistory')) {
      const store = database.createObjectStore('interfaceAnnounceHistory', { keyPath: 'id' });
      store.createIndex('identityId', 'identityId');
      store.createIndex('interfaceId', 'interfaceId');
    }
    if (event.oldVersion > 0 && event.oldVersion < 13) {
      migrateDestinationDirectories(request, database);
    } else if (database.objectStoreNames.contains('propagationNodes')) {
      database.deleteObjectStore('propagationNodes');
    }
    if (event.oldVersion > 0 && event.oldVersion < 14) migrateChatMessageOrdering(request);
    if (event.oldVersion > 0 && event.oldVersion < 16) migrateInterfaceCreationTimes(request);
  };
  return requestResult(request);
}

function migrateInterfaceCreationTimes(request: IDBOpenDBRequest): void {
  const transaction = request.transaction;
  if (!transaction) return;
  const store = transaction.objectStore('interfaces');
  const interfacesRequest = store.getAll();
  interfacesRequest.onsuccess = () => {
    interfacesRequest.result.forEach((value, index) => {
      if (!value || typeof value !== 'object') return;
      const source = value as Record<string, unknown>;
      const createdAt = typeof source.createdAt === 'string'
        && Number.isFinite(Date.parse(source.createdAt))
        ? source.createdAt
        : new Date(index).toISOString();
      const normalized = normalizeInterfaceConfig({ ...source, createdAt });
      if (normalized) store.put(normalized);
    });
  };
}

function migrateChatMessageOrdering(request: IDBOpenDBRequest): void {
  const transaction = request.transaction;
  if (!transaction) return;
  const store = transaction.objectStore('chatMessages');
  const messagesRequest = store.getAll();
  messagesRequest.onsuccess = () => {
    const messages = assignChatMessageOrderings(messagesRequest.result as ChatMessage[]);
    for (const message of messages) store.put(message);
  };
}

function migrateDestinationDirectories(
  request: IDBOpenDBRequest,
  database: IDBDatabase,
): void {
  const transaction = request.transaction;
  if (!transaction) return;
  const legacyStoreNames = [
    'chatAnnounces',
    'nomadAnnounces',
    'knownDestinationNames',
    'provisioningNodes',
  ].filter((name) => database.objectStoreNames.contains(name));
  if (legacyStoreNames.length === 0) {
    if (database.objectStoreNames.contains('propagationNodes')) {
      database.deleteObjectStore('propagationNodes');
    }
    return;
  }

  const legacyRecords = new Map<string, unknown[]>();
  let pending = legacyStoreNames.length;
  for (const storeName of legacyStoreNames) {
    const recordsRequest = transaction.objectStore(storeName).getAll();
    recordsRequest.onsuccess = () => {
      legacyRecords.set(storeName, recordsRequest.result);
      pending -= 1;
      if (pending === 0) finishDestinationDirectoryMigration(database, transaction, legacyRecords);
    };
  }
}

function finishDestinationDirectoryMigration(
  database: IDBDatabase,
  transaction: IDBTransaction,
  legacyRecords: ReadonlyMap<string, unknown[]>,
): void {
  const destinations = new Map<string, KnownDestinationRecord>();

  for (const value of legacyRecords.get('chatAnnounces') ?? []) {
    const source = recordValue(value);
    const destinationHash = destinationHashOf(source);
    if (!source || !destinationHash) continue;
    mergeLegacyDestination(destinations, {
      destinationHash,
      fullDestinationName: 'lxmf.delivery',
      lastAnnouncedAt: dateValue(source.heardAt),
      displayName: stringValue(source.displayName),
      metadata: {
        ...(numberValue(source.stampCost) !== undefined
          ? { stampCost: numberValue(source.stampCost) }
          : {}),
        ...(booleanValue(source.compressionSupported) !== undefined
          ? { compressionSupported: booleanValue(source.compressionSupported) }
          : {}),
      },
    });
  }

  for (const value of legacyRecords.get('nomadAnnounces') ?? []) {
    const source = recordValue(value);
    const destinationHash = destinationHashOf(source);
    if (!source || !destinationHash) continue;
    mergeLegacyDestination(destinations, {
      destinationHash,
      fullDestinationName: 'nomadnetwork.node',
      lastAnnouncedAt: dateValue(source.heardAt),
      displayName: stringValue(source.displayName),
      metadata: {},
    });
  }

  const provisioningBookmarks = transaction.objectStore('provisioningBookmarks');
  for (const value of legacyRecords.get('provisioningNodes') ?? []) {
    const source = recordValue(value);
    const destinationHash = destinationHashOf(source);
    if (!source || !destinationHash) continue;
    mergeLegacyDestination(destinations, {
      destinationHash,
      fullDestinationName: 'rnstransport.remote.management',
      lastAnnouncedAt: dateValue(source.heardAt),
      metadata: {},
    });
    const label = stringValue(source.label);
    if (source.bookmarked === true) {
      const timestamp = dateValue(source.heardAt) ?? new Date(0).toISOString();
      provisioningBookmarks.put({
        id: destinationHash,
        destinationHash,
        ...(label ? { label } : {}),
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }
  }

  for (const value of legacyRecords.get('knownDestinationNames') ?? []) {
    const source = recordValue(value);
    const destinationHash = destinationHashOf(source);
    const displayName = stringValue(source?.displayName);
    if (!source || !destinationHash || !displayName) continue;
    mergeLegacyDestination(destinations, {
      destinationHash,
      lastAnnouncedAt: dateValue(source.updatedAt),
      displayName,
    });
  }

  const destinationStore = transaction.objectStore('knownDestinations');
  for (const destination of destinations.values()) destinationStore.put(destination);

  for (const storeName of legacyRecords.keys()) {
    if (database.objectStoreNames.contains(storeName)) database.deleteObjectStore(storeName);
  }
  if (database.objectStoreNames.contains('propagationNodes')) {
    database.deleteObjectStore('propagationNodes');
  }
}

function mergeLegacyDestination(
  destinations: Map<string, KnownDestinationRecord>,
  incoming: KnownDestinationRecord,
): void {
  const current = destinations.get(incoming.destinationHash);
  if (current?.lastAnnouncedAt && incoming.lastAnnouncedAt
    && current.lastAnnouncedAt > incoming.lastAnnouncedAt) {
    destinations.set(incoming.destinationHash, {
      ...incoming,
      ...current,
      displayName: current.displayName ?? incoming.displayName,
      metadata: current.metadata ?? incoming.metadata,
    });
    return;
  }
  destinations.set(incoming.destinationHash, {
    ...current,
    ...incoming,
    displayName: incoming.displayName ?? current?.displayName,
    metadata: incoming.metadata ?? current?.metadata,
  });
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? value as Record<string, unknown> : undefined;
}

function destinationHashOf(
  value: Record<string, unknown> | undefined,
): string | undefined {
  const destinationHash = typeof value?.destinationHash === 'string'
    ? value.destinationHash.trim().toLowerCase()
    : '';
  return /^[0-9a-f]{32}$/.test(destinationHash) ? destinationHash : undefined;
}

function stringValue(value: unknown): string | undefined {
  const normalized = typeof value === 'string' ? value.trim().slice(0, 256) : '';
  return normalized || undefined;
}

function dateValue(value: unknown): string | undefined {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}
