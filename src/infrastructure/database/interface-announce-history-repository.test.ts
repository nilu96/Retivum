import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createInterfaceAnnounceHistoryRecord,
} from '../../domain/interface-announce';
import { openRetivumDatabase, transactionDone } from './database';
import { BrowserInterfaceAnnounceHistoryRepository } from './interface-announce-history-repository';

function deleteDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase('retivum');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('DATABASE_DELETE_BLOCKED'));
  });
}

describe('BrowserInterfaceAnnounceHistoryRepository', () => {
  beforeEach(deleteDatabase);

  it('adds an empty history store when upgrading an existing database', async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('retivum', 14);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('settings');
      };
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
      request.onerror = () => reject(request.error);
    });

    const repository = new BrowserInterfaceAnnounceHistoryRepository();
    expect(await repository.load('identity-1')).toEqual([]);
  });

  it('persists and loads records within one identity scope', async () => {
    const repository = new BrowserInterfaceAnnounceHistoryRepository();
    const first = createInterfaceAnnounceHistoryRecord(
      'identity-1',
      'interface-1',
      'network-1',
      '12'.repeat(16),
      'announce-fingerprint-1',
      '2026-07-29T12:00:00.000Z',
    );
    const second = createInterfaceAnnounceHistoryRecord(
      'identity-2',
      'interface-1',
      'network-1',
      '34'.repeat(16),
      'announce-fingerprint-2',
      '2026-07-29T12:01:00.000Z',
    );

    await repository.save([first, second]);

    expect(await repository.load('identity-1')).toEqual([first]);
    expect(await repository.load('identity-2')).toEqual([second]);
  });

  it('treats incomplete records without an announce fingerprint as stale', async () => {
    const database = await openRetivumDatabase();
    const transaction = database.transaction('interfaceAnnounceHistory', 'readwrite');
    transaction.objectStore('interfaceAnnounceHistory').put({
      id: 'legacy-record',
      schemaVersion: 1,
      identityId: 'identity-1',
      interfaceId: 'interface-1',
      networkFingerprint: 'network-1',
      destinationHash: '12'.repeat(16),
      lastAnnouncedAt: '2026-07-29T12:00:00.000Z',
    });
    await transactionDone(transaction);
    database.close();

    const repository = new BrowserInterfaceAnnounceHistoryRepository();
    expect(await repository.load('identity-1')).toEqual([]);
  });

  it('updates the successful dispatch time and announce fingerprint for an existing tuple', async () => {
    const repository = new BrowserInterfaceAnnounceHistoryRepository();
    const record = createInterfaceAnnounceHistoryRecord(
      'identity-1',
      'interface-1',
      'network-1',
      '12'.repeat(16),
      'announce-fingerprint-1',
      '2026-07-29T12:00:00.000Z',
    );
    await repository.save([record]);
    await repository.save([{
      ...record,
      announceFingerprint: 'announce-fingerprint-2',
      lastAnnouncedAt: '2026-07-29T13:00:00.000Z',
    }]);

    expect((await repository.load('identity-1'))[0]).toMatchObject({
      announceFingerprint: 'announce-fingerprint-2',
      lastAnnouncedAt: '2026-07-29T13:00:00.000Z',
    });
  });
});
