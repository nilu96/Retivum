import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { PersistedIdentityRecord } from '../../domain/identity';
import { BrowserIdentityRepository } from './identity-repository';

function deleteDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase('retivum');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('DATABASE_DELETE_BLOCKED'));
  });
}

describe('BrowserIdentityRepository', () => {
  beforeEach(deleteDatabase);

  it('stores a non-extractable origin-bound wrapping key', async () => {
    const repository = new BrowserIdentityRepository();
    const first = await repository.getOrCreateWrappingKey();
    const restored = await repository.getOrCreateWrappingKey();
    const plaintext = new TextEncoder().encode('retivum-identity-test');
    const iv = new Uint8Array(12);
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv.buffer }, first, plaintext.buffer);
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv.buffer }, restored, ciphertext);

    expect(first.extractable).toBe(false);
    expect(new TextDecoder().decode(decrypted)).toBe('retivum-identity-test');
  });

  it('persists and restores the active encrypted identity record', async () => {
    const repository = new BrowserIdentityRepository();
    const identity: PersistedIdentityRecord = {
      id: 'identity-1',
      schemaVersion: 1,
      label: 'Default identity',
      displayName: 'Anonymous',
      identityHash: new Uint8Array([1, 2, 3]),
      publicKey: new Uint8Array([4, 5, 6]),
      encryptedPrivateKey: {
        algorithm: 'AES-GCM',
        iv: new Uint8Array(12),
        ciphertext: new Uint8Array([7, 8, 9]),
      },
      createdAt: '2026-07-16T00:00:00.000Z',
      updatedAt: '2026-07-16T00:00:00.000Z',
    };

    await repository.saveAndActivate(identity);
    const restored = await repository.loadActiveIdentity();
    expect(restored).toMatchObject({
      id: identity.id,
      label: identity.label,
      displayName: identity.displayName,
      createdAt: identity.createdAt,
    });
    expect(Array.from(restored?.identityHash ?? [])).toEqual([1, 2, 3]);
    expect(Array.from(restored?.encryptedPrivateKey.ciphertext ?? [])).toEqual([7, 8, 9]);
  });

  it('lists, activates, and deletes only inactive identities', async () => {
    const repository = new BrowserIdentityRepository();
    const identity = (id: string): PersistedIdentityRecord => ({
      id,
      schemaVersion: 1,
      label: id,
      displayName: id,
      identityHash: new Uint8Array([id === 'identity-1' ? 1 : 2]),
      publicKey: new Uint8Array([3]),
      encryptedPrivateKey: {
        algorithm: 'AES-GCM',
        iv: new Uint8Array(12),
        ciphertext: new Uint8Array([4]),
      },
      createdAt: `2026-07-16T00:00:0${id === 'identity-1' ? 1 : 2}.000Z`,
      updatedAt: '2026-07-16T00:00:00.000Z',
    });

    await repository.saveAndActivate(identity('identity-1'));
    await repository.save(identity('identity-2'));
    expect((await repository.loadAll()).map((item) => item.id)).toEqual(['identity-1', 'identity-2']);

    await repository.setActive('identity-2');
    expect((await repository.loadActiveIdentity())?.id).toBe('identity-2');
    await expect(repository.delete('identity-2')).rejects.toThrow('ACTIVE_IDENTITY_DELETE_FORBIDDEN');
    await repository.delete('identity-1');
    expect((await repository.loadAll()).map((item) => item.id)).toEqual(['identity-2']);
  });
});
