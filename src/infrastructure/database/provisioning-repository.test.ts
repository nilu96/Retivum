import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ProvisioningSchema } from '../../domain/provisioning';
import { BrowserKnownDestinationRepository } from './known-destination-repository';
import { BrowserProvisioningRepository } from './provisioning-repository';

function deleteDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase('retivum');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('DATABASE_DELETE_BLOCKED'));
  });
}

function schema(id: number): ProvisioningSchema {
  return { namespaces: [{ id, name: `Namespace ${id}`, parentId: 0, fields: [] }] };
}

describe('BrowserProvisioningRepository', () => {
  beforeEach(deleteDatabase);

  it('persists management destination bookmarks separately from destination data', async () => {
    const repository = new BrowserProvisioningRepository();
    await repository.saveBookmark({
      id: 'older',
      destinationHash: '0123456789abcdef0123456789abcdef',
      label: 'Older',
      createdAt: '2026-07-19T10:00:00.000Z',
      updatedAt: '2026-07-19T10:00:00.000Z',
    });
    await repository.saveBookmark({
      id: 'newer',
      destinationHash: 'fedcba9876543210fedcba9876543210',
      label: 'Alpha',
      createdAt: '2026-07-20T10:00:00.000Z',
      updatedAt: '2026-07-20T10:00:00.000Z',
    });

    expect((await repository.loadBookmarks()).map((bookmark) => bookmark.id)).toEqual(['newer', 'older']);
  });

  it('deletes an existing bookmark and reports missing bookmarks', async () => {
    const repository = new BrowserProvisioningRepository();
    await repository.saveBookmark({
      id: 'node',
      destinationHash: '0123456789abcdef0123456789abcdef',
      label: 'Workshop router',
      createdAt: '2026-07-20T10:00:00.000Z',
      updatedAt: '2026-07-20T10:00:00.000Z',
    });

    expect(await repository.deleteBookmark('node')).toBe(true);
    expect(await repository.deleteBookmark('node')).toBe(false);
    expect(await repository.loadBookmarks()).toEqual([]);
  });

  it('migrates legacy management nodes into directory records and bookmarks', async () => {
    const request = indexedDB.open('retivum', 10);
    await new Promise<void>((resolve, reject) => {
      request.onupgradeneeded = () => {
        request.result.createObjectStore('provisioningNodes', { keyPath: 'id' });
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction('provisioningNodes', 'readwrite');
        transaction.objectStore('provisioningNodes').put({
          id: 'd'.repeat(32),
          destinationHash: 'd'.repeat(32),
          publicKey: 'e'.repeat(128),
          heardAt: '2026-07-20T10:00:00.000Z',
          bookmarked: true,
          label: 'Workshop router',
        });
        transaction.oncomplete = () => {
          database.close();
          resolve();
        };
        transaction.onerror = () => reject(transaction.error);
      };
    });

    expect(await new BrowserKnownDestinationRepository().loadAll()).toEqual([{
      destinationHash: 'd'.repeat(32),
      fullDestinationName: 'rnstransport.remote.management',
      lastAnnouncedAt: '2026-07-20T10:00:00.000Z',
      metadata: {},
    }]);
    expect(await new BrowserProvisioningRepository().loadBookmarks()).toEqual([{
      id: 'd'.repeat(32),
      destinationHash: 'd'.repeat(32),
      label: 'Workshop router',
      createdAt: '2026-07-20T10:00:00.000Z',
      updatedAt: '2026-07-20T10:00:00.000Z',
    }]);
  });

  it('caches schemas by version and hash and retains only the five newest entries', async () => {
    const repository = new BrowserProvisioningRepository();
    for (let index = 1; index <= 6; index += 1) {
      await repository.saveSchema(2, index, schema(index));
    }

    expect(await repository.loadSchema(2, 1)).toBeUndefined();
    expect(await repository.loadSchema(2, 6)).toEqual(schema(6));
  });
});
