import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { createRNodeInterfaceDraft, createTcpInterfaceDraft, createUdpInterfaceDraft, createWebSocketInterfaceDraft } from '../../domain/settings';
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
    expect(initial.preferences.lxmf.propagationEnabled).toBe(false);
    expect(initial.preferences.lxmf.propagationSyncIntervalMinutes).toBe(0);
    expect(initial.preferences.lxmf.autoAnnounceIntervalMinutes).toBe(0);
    expect(initial.preferences.chat).toEqual({
      imageDownscalingMode: 'ask',
      imageDownscalingMaxLongEdge: 1_500,
      messageRetentionDays: 0,
    });
    expect(initial.interfaces).toEqual([]);

    const config = createWebSocketInterfaceDraft('home-relay');
    config.name = 'Home relay';
    initial.preferences.transportEnabled = true;
    initial.preferences.chat.imageDownscalingMode = 'automatic';
    initial.preferences.chat.imageDownscalingMaxLongEdge = 1_200;
    initial.preferences.chat.messageRetentionDays = 2;
    await repository.savePreferences(initial.preferences);
    await repository.saveInterface(config);

    const restored = await repository.load();
    expect(restored.preferences.transportEnabled).toBe(true);
    expect(restored.preferences.chat).toEqual({
      imageDownscalingMode: 'automatic',
      imageDownscalingMaxLongEdge: 1_200,
      messageRetentionDays: 2,
    });
    expect(restored.interfaces).toEqual([config]);
  });

  it('deletes an interface without changing preferences', async () => {
    const repository = new BrowserSettingsRepository();
    const config = createWebSocketInterfaceDraft('temporary-relay');
    config.name = 'Temporary relay';
    await repository.saveInterface(config);
    await repository.deleteInterface(config.id);

    expect((await repository.load()).interfaces).toEqual([]);
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
});
