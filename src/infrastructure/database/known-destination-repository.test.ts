import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { BrowserKnownDestinationRepository } from './known-destination-repository';

function deleteDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase('retivum');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('DATABASE_DELETE_BLOCKED'));
  });
}

describe('BrowserKnownDestinationRepository', () => {
  beforeEach(deleteDatabase);

  it('stores complete remote destination records globally by destination hash', async () => {
    const repository = new BrowserKnownDestinationRepository();
    const record = {
      destinationHash: 'a'.repeat(32),
      fullDestinationName: 'lxmf.delivery' as const,
      displayName: 'Shared destination',
      lastAnnouncedAt: '2026-07-24T10:00:00.000Z',
      metadata: { stampCost: 8, compressionSupported: true },
    };

    await repository.save(record);

    expect(await repository.loadAll()).toEqual([record]);
  });

  it('replaces and removes directory records atomically', async () => {
    const repository = new BrowserKnownDestinationRepository();
    const first = { destinationHash: 'a'.repeat(32) };
    const second = {
      destinationHash: 'b'.repeat(32),
      fullDestinationName: 'nomadnetwork.node' as const,
    };

    await repository.replaceAll([first, second]);
    expect(await repository.loadAll()).toEqual([first, second]);

    await repository.delete(first.destinationHash);
    expect(await repository.loadAll()).toEqual([second]);

    await repository.clear();
    expect(await repository.loadAll()).toEqual([]);
  });

  it('migrates the previous global display-name store into directory records', async () => {
    const request = indexedDB.open('retivum', 12);
    await new Promise<void>((resolve, reject) => {
      request.onupgradeneeded = () => {
        request.result.createObjectStore('knownDestinationNames', { keyPath: 'destinationHash' });
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction('knownDestinationNames', 'readwrite');
        transaction.objectStore('knownDestinationNames').put({
          destinationHash: 'c'.repeat(32),
          displayName: 'Remembered name',
          updatedAt: '2026-07-24T12:00:00.000Z',
        });
        transaction.oncomplete = () => {
          database.close();
          resolve();
        };
        transaction.onerror = () => reject(transaction.error);
      };
    });

    expect(await new BrowserKnownDestinationRepository().loadAll()).toEqual([{
      destinationHash: 'c'.repeat(32),
      displayName: 'Remembered name',
      lastAnnouncedAt: '2026-07-24T12:00:00.000Z',
    }]);
  });
});
