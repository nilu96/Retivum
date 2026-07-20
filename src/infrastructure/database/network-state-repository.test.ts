import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { PersistedNetworkStateRecord } from '../../domain/network-state';
import { BrowserNetworkStateRepository } from './network-state-repository';

function deleteDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase('retivum');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('DATABASE_DELETE_BLOCKED'));
  });
}

describe('BrowserNetworkStateRepository', () => {
  beforeEach(deleteDatabase);

  it('persists the encrypted identity-independent network checkpoint', async () => {
    const repository = new BrowserNetworkStateRepository();
    const state: PersistedNetworkStateRecord = {
      schemaVersion: 1,
      encryptedSnapshot: {
        algorithm: 'AES-GCM',
        iv: new Uint8Array([1, 2, 3]),
        ciphertext: new Uint8Array([4, 5, 6]),
      },
      updatedAt: '2026-07-18T12:00:00.000Z',
    };

    expect(await repository.load()).toBeUndefined();
    await repository.save(state);

    const restored = await repository.load();
    expect(restored?.schemaVersion).toBe(1);
    expect(restored?.updatedAt).toBe(state.updatedAt);
    expect(Array.from(restored?.encryptedSnapshot.iv ?? [])).toEqual([1, 2, 3]);
    expect(Array.from(restored?.encryptedSnapshot.ciphertext ?? [])).toEqual([4, 5, 6]);
  });
});
