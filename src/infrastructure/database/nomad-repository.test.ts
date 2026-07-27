import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { BrowserKnownDestinationRepository } from './known-destination-repository';
import { BrowserNomadRepository } from './nomad-repository';

function deleteDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase('retivum');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('DATABASE_DELETE_BLOCKED'));
  });
}

function createLegacyNomadDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('retivum', 9);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('nomadAnnounces', { keyPath: 'id' });
      request.result.createObjectStore('nomadBookmarks', { keyPath: 'id' });
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction(['nomadAnnounces', 'nomadBookmarks'], 'readwrite');
      transaction.objectStore('nomadAnnounces').put({
        id: `identity-1:${'a'.repeat(32)}`,
        identityId: 'identity-1',
        destinationHash: 'a'.repeat(32),
        displayName: 'Older name',
        heardAt: '2026-07-16T10:00:00.000Z',
      });
      transaction.objectStore('nomadAnnounces').put({
        id: `identity-2:${'a'.repeat(32)}`,
        identityId: 'identity-2',
        destinationHash: 'a'.repeat(32),
        displayName: 'Newest name',
        publicKey: 'b'.repeat(128),
        heardAt: '2026-07-16T11:00:00.000Z',
      });
      transaction.objectStore('nomadBookmarks').put({
        id: 'identity-2:bookmark',
        identityId: 'identity-2',
        destinationHash: 'a'.repeat(32),
        path: '/page/index.mu',
        createdAt: '2026-07-16T12:00:00.000Z',
      });
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    };
  });
}

describe('BrowserNomadRepository', () => {
  beforeEach(deleteDatabase);

  it('keeps bookmarks scoped to the active identity', async () => {
    const repository = new BrowserNomadRepository();
    await repository.saveBookmark({
      id: 'identity-1:destination-1:/start',
      identityId: 'identity-1',
      destinationHash: '0123456789abcdef0123456789abcdef',
      path: '/start',
      label: 'Community node',
      createdAt: '2026-07-16T10:01:00.000Z',
    });

    const matching = await repository.loadBookmarks('identity-1');
    expect(matching).toHaveLength(1);
    expect(matching[0].label).toBe('Community node');
    expect(await repository.loadBookmarks('identity-2')).toEqual([]);

    await repository.deleteBookmark(matching[0].id);
    expect(await repository.loadBookmarks('identity-1')).toEqual([]);
  });

  it('atomically replaces a bookmark when its address changes', async () => {
    const repository = new BrowserNomadRepository();
    const previousId = 'identity-1:old-address';
    await repository.saveBookmark({
      id: previousId,
      identityId: 'identity-1',
      destinationHash: 'a'.repeat(32),
      path: '/start',
      label: 'Community node',
      createdAt: '2026-07-16T10:01:00.000Z',
    });
    const updated = {
      id: `identity-1:${'b'.repeat(32)}:/page/edited.mu`,
      identityId: 'identity-1',
      destinationHash: 'b'.repeat(32),
      path: '/page/edited.mu',
      requestData: { var_c: 'heap' },
      label: 'Edited node',
      createdAt: '2026-07-16T10:01:00.000Z',
    };

    await repository.replaceBookmark(previousId, updated);

    expect(await repository.loadBookmarks('identity-1')).toEqual([updated]);
  });

  it('migrates legacy announces into the shared destination directory', async () => {
    await createLegacyNomadDatabase();

    expect(await new BrowserKnownDestinationRepository().loadAll()).toEqual([{
      destinationHash: 'a'.repeat(32),
      fullDestinationName: 'nomadnetwork.node',
      displayName: 'Newest name',
      lastAnnouncedAt: '2026-07-16T11:00:00.000Z',
      metadata: {},
    }]);
    expect(await new BrowserNomadRepository().loadBookmarks('identity-2')).toEqual([
      expect.objectContaining({ id: 'identity-2:bookmark', identityId: 'identity-2' }),
    ]);
  });
});
