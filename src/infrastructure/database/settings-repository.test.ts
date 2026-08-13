import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { createRNodeInterfaceDraft, createTcpInterfaceDraft, createUdpInterfaceDraft, createWebSocketInterfaceDraft } from '../../domain/settings';
import {
  createInterfaceAnnounceHistoryRecord,
  interfaceNetworkFingerprint,
} from '../../domain/interface-announce';
import { BrowserInterfaceAnnounceHistoryRepository } from './interface-announce-history-repository';
import { BrowserSettingsRepository } from './settings-repository';

function deleteDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase('retivum');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('DATABASE_DELETE_BLOCKED'));
  });
}

describe('BrowserSettingsRepository', () => {
  beforeEach(deleteDatabase);

  it('starts with zero interfaces and persists settings records', async () => {
    const repository = new BrowserSettingsRepository();
    const initial = await repository.load();

    expect(initial.preferences.transportEnabled).toBe(false);
    expect(initial.preferences.lxmf.defaultDeliveryMethod).toBe('direct');
    expect(initial.preferences.lxmf.propagationEnabled).toBe(true);
    expect(initial.preferences.lxmf.propagationSyncIntervalMinutes).toBe(0);
    expect(initial.preferences.lxmf.propagationSyncOnResume).toBe(false);
    expect(initial.preferences.lxmf.autoAnnounceIntervalMinutes).toBe(360);
    expect(initial.preferences.chat).toEqual({
      inAppNotificationMode: 'all',
      imageDownscalingMode: 'ask',
      imageDownscalingMaxLongEdge: 1_500,
      messageRetentionDays: 0,
    });
    expect(initial.interfaces).toEqual([]);

    const config = createWebSocketInterfaceDraft('home-relay');
    config.name = 'Home relay';
    initial.preferences.transportEnabled = true;
    initial.preferences.chat.inAppNotificationMode = 'contacts';
    initial.preferences.chat.imageDownscalingMode = 'automatic';
    initial.preferences.chat.imageDownscalingMaxLongEdge = 1_200;
    initial.preferences.chat.messageRetentionDays = 2;
    await repository.savePreferences(initial.preferences);
    await repository.saveInterface(config);

    const restored = await repository.load();
    expect(restored.preferences.transportEnabled).toBe(true);
    expect(restored.preferences.chat).toEqual({
      inAppNotificationMode: 'contacts',
      imageDownscalingMode: 'automatic',
      imageDownscalingMaxLongEdge: 1_200,
      messageRetentionDays: 2,
    });
    expect(restored.interfaces).toEqual([config]);
  });

  it('stores IFAC passphrases with the interface configuration', async () => {
    const repository = new BrowserSettingsRepository();
    const config = createWebSocketInterfaceDraft('protected-relay');
    config.name = 'Protected relay';
    config.ifac.networkName = 'field-network';
    config.ifac.passphrase = 'correct horse battery staple';
    config.ifac.sizeBytes = 31;
    await repository.saveInterface(config);

    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('retivum');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction('interfaces', 'readonly');
    const stored = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const request = transaction.objectStore('interfaces').get(config.id);
      request.onsuccess = () => resolve(request.result as Record<string, unknown>);
      request.onerror = () => reject(request.error);
    });
    database.close();

    expect(stored).toMatchObject({
      ifac: {
        networkName: 'field-network',
        passphrase: 'correct horse battery staple',
        sizeBytes: 31,
      },
    });
    expect((await repository.load()).interfaces).toEqual([config]);
  });

  it('deletes an interface without changing preferences', async () => {
    const repository = new BrowserSettingsRepository();
    const historyRepository = new BrowserInterfaceAnnounceHistoryRepository();
    const config = createWebSocketInterfaceDraft('temporary-relay');
    config.name = 'Temporary relay';
    await repository.saveInterface(config);
    await historyRepository.save([createInterfaceAnnounceHistoryRecord(
      'identity-1',
      config.id,
      interfaceNetworkFingerprint(config),
      '12'.repeat(16),
      'announce-fingerprint-1',
      '2026-07-29T12:00:00.000Z',
    )]);
    await repository.deleteInterface(config.id);

    expect((await repository.load()).interfaces).toEqual([]);
    expect(await historyRepository.load('identity-1')).toEqual([]);
  });

  it('persists disabling and re-enabling an interface', async () => {
    const repository = new BrowserSettingsRepository();
    const config = createWebSocketInterfaceDraft('switchable-relay');
    config.name = 'Switchable relay';
    await repository.saveInterface(config);

    await repository.saveInterface({ ...config, enabled: false });
    expect((await repository.load()).interfaces[0]?.enabled).toBe(false);

    await repository.saveInterface({ ...config, enabled: true });
    expect((await repository.load()).interfaces[0]?.enabled).toBe(true);
  });

  it('loads interfaces by creation time and preserves creation time across edits', async () => {
    const repository = new BrowserSettingsRepository();
    const older = createTcpInterfaceDraft('z-older', '2026-07-29T12:00:00.000Z');
    const newer = createTcpInterfaceDraft('a-newer', '2026-07-29T12:01:00.000Z');
    await repository.saveInterface(newer);
    await repository.saveInterface(older);

    expect((await repository.load()).interfaces.map((config) => config.id)).toEqual([
      older.id,
      newer.id,
    ]);

    await repository.saveInterface({
      ...newer,
      name: 'Edited',
      createdAt: '2020-01-01T00:00:00.000Z',
    });
    const restored = await repository.load();
    expect(restored.interfaces.map((config) => config.id)).toEqual([older.id, newer.id]);
    expect(restored.interfaces[1]?.createdAt).toBe(newer.createdAt);
  });

  it('preserves history for policy edits and clears it after a material network change', async () => {
    const repository = new BrowserSettingsRepository();
    const historyRepository = new BrowserInterfaceAnnounceHistoryRepository();
    const config = createWebSocketInterfaceDraft('editable-relay');
    await repository.saveInterface(config);
    const history = createInterfaceAnnounceHistoryRecord(
      'identity-1',
      config.id,
      interfaceNetworkFingerprint(config),
      '12'.repeat(16),
      'announce-fingerprint-1',
      '2026-07-29T12:00:00.000Z',
    );
    await historyRepository.save([history]);

    await repository.saveInterface({
      ...config,
      name: 'Renamed relay',
      enabled: false,
      reannounceOnReconnect: false,
    });
    expect(await historyRepository.load('identity-1')).toEqual([history]);

    await repository.saveInterface({
      ...config,
      connection: { ...config.connection, host: 'another-relay.example' },
    });
    expect(await historyRepository.load('identity-1')).toEqual([]);
  });

  it('persists heterogeneous interface configurations', async () => {
    const repository = new BrowserSettingsRepository();
    const rnode = createRNodeInterfaceDraft('ble', 'rnode-1');
    rnode.name = 'Portable LoRa';
    rnode.connection.deviceId = 'ble-id';
    const tcp = createTcpInterfaceDraft('tcp-1');
    tcp.name = 'Desktop TCP';
    const udp = createUdpInterfaceDraft('udp-1');
    udp.name = 'LAN UDP';
    await repository.saveInterface(rnode);
    await repository.saveInterface(tcp);
    await repository.saveInterface(udp);
    expect((await repository.load()).interfaces).toEqual(expect.arrayContaining([rnode, tcp, udp]));
  });

  it('migrates legacy interfaces to one deterministic persisted creation order', async () => {
    const request = indexedDB.open('retivum', 15);
    await new Promise<void>((resolve, reject) => {
      request.onupgradeneeded = () => {
        request.result.createObjectStore('settings');
        request.result.createObjectStore('interfaces', { keyPath: 'id' });
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction('interfaces', 'readwrite');
        const store = transaction.objectStore('interfaces');
        const first = createWebSocketInterfaceDraft('z-legacy-first');
        const second = createWebSocketInterfaceDraft('a-legacy-second');
        const { createdAt: _firstCreatedAt, ...legacyFirst } = first;
        const { createdAt: _secondCreatedAt, ...legacySecond } = second;
        store.put({ ...legacyFirst, schemaVersion: 3 });
        store.put({ ...legacySecond, schemaVersion: 3 });
        transaction.oncomplete = () => {
          database.close();
          resolve();
        };
        transaction.onerror = () => reject(transaction.error);
      };
    });

    const repository = new BrowserSettingsRepository();
    const firstLoad = await repository.load();
    const secondLoad = await repository.load();
    expect(firstLoad.interfaces.map((config) => config.id)).toEqual([
      'a-legacy-second',
      'z-legacy-first',
    ]);
    expect(secondLoad.interfaces).toEqual(firstLoad.interfaces);
    expect(firstLoad.interfaces.map((config) => config.createdAt)).toEqual([
      '1970-01-01T00:00:00.000Z',
      '1970-01-01T00:00:00.001Z',
    ]);
    expect(firstLoad.interfaces.every((config) => config.schemaVersion === 5)).toBe(true);
  });
});
