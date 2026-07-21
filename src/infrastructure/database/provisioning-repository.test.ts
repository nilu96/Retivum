import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ProvisioningSchema } from '../../domain/provisioning';
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

  it('persists management destinations globally in newest-first order', async () => {
    const repository = new BrowserProvisioningRepository();
    await repository.saveNode({
      id: 'older',
      destinationHash: '0123456789abcdef0123456789abcdef',
      publicKey: '01'.repeat(64),
      heardAt: '2026-07-19T10:00:00.000Z',
    });
    await repository.saveNode({
      id: 'newer',
      destinationHash: 'fedcba9876543210fedcba9876543210',
      publicKey: '02'.repeat(64),
      heardAt: '2026-07-20T10:00:00.000Z',
    });

    expect((await repository.loadNodes()).map((node) => node.id)).toEqual(['newer', 'older']);
  });

  it('persists a management destination bookmark without changing its announce data', async () => {
    const repository = new BrowserProvisioningRepository();
    await repository.saveNode({
      id: 'node',
      destinationHash: '0123456789abcdef0123456789abcdef',
      publicKey: '01'.repeat(64),
      heardAt: '2026-07-20T10:00:00.000Z',
    });

    expect(await repository.setNodeBookmarked('node', true, '  Workshop router  ')).toMatchObject({
      id: 'node',
      bookmarked: true,
      label: 'Workshop router',
      heardAt: '2026-07-20T10:00:00.000Z',
    });
    expect(await repository.loadNodes()).toEqual([
      expect.objectContaining({ id: 'node', bookmarked: true, label: 'Workshop router' }),
    ]);

    expect(await repository.setNodeBookmarked('node', false)).toMatchObject({
      id: 'node',
      bookmarked: false,
      label: undefined,
    });
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
