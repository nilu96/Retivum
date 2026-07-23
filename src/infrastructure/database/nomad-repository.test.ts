import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
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
      const announces = transaction.objectStore('nomadAnnounces');
      announces.put({
        id: `identity-1:${'a'.repeat(32)}`,
        identityId: 'identity-1',
        destinationHash: 'a'.repeat(32),
        displayName: 'Older name',
        heardAt: '2026-07-16T10:00:00.000Z',
      });
      announces.put({
        id: `identity-2:${'a'.repeat(32)}`,
        identityId: 'identity-2',
        destinationHash: 'a'.repeat(32),
        displayName: 'Newest name',
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

  it('shares announces globally while keeping bookmarks scoped to the active identity', async () => {
    const repository = new BrowserNomadRepository();
    await repository.saveAnnounce({
      id: '0123456789abcdef0123456789abcdef',
      destinationHash: '0123456789abcdef0123456789abcdef',
      displayName: 'Forest Node',
      heardAt: '2026-07-16T10:00:00.000Z',
    });
    await repository.saveBookmark({
      id: 'identity-1:destination-1:/start',
      identityId: 'identity-1',
      destinationHash: '0123456789abcdef0123456789abcdef',
      path: '/start',
      label: 'Community node',
      createdAt: '2026-07-16T10:01:00.000Z',
    });

    const matching = await repository.load('identity-1');
    expect(matching.announces).toHaveLength(1);
    expect(matching.announces[0].displayName).toBe('Forest Node');
    expect(matching.bookmarks).toHaveLength(1);
    expect(matching.bookmarks[0].label).toBe('Community node');
    expect(await repository.load('identity-2')).toEqual({
      announces: [expect.objectContaining({ displayName: 'Forest Node' })],
      bookmarks: [],
    });

    await repository.deleteBookmark(matching.bookmarks[0].id);
    expect((await repository.load('identity-1')).bookmarks).toEqual([]);
  });

  it('migrates legacy per-identity announces into one newest global destination record', async () => {
    await createLegacyNomadDatabase();
    const directory = await new BrowserNomadRepository().load('identity-2');

    expect(directory.announces).toEqual([{
      id: 'a'.repeat(32),
      destinationHash: 'a'.repeat(32),
      displayName: 'Newest name',
      heardAt: '2026-07-16T11:00:00.000Z',
    }]);
    expect(directory.bookmarks).toEqual([
      expect.objectContaining({ id: 'identity-2:bookmark', identityId: 'identity-2' }),
    ]);
  });
});
