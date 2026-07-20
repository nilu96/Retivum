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

describe('BrowserNomadRepository', () => {
  beforeEach(deleteDatabase);

  it('keeps announces and bookmarks scoped to the active identity', async () => {
    const repository = new BrowserNomadRepository();
    await repository.saveAnnounce({
      id: 'identity-1:destination-1',
      identityId: 'identity-1',
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
    expect(await repository.load('identity-2')).toEqual({ announces: [], bookmarks: [] });

    await repository.deleteBookmark(matching.bookmarks[0].id);
    expect((await repository.load('identity-1')).bookmarks).toEqual([]);
  });
});
