import { get } from 'svelte/store';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRNodeInterfaceDraft } from '../../domain/settings';
import {
  blockedChatDestinations,
  chatMessages,
  onAutomaticPropagationSyncComplete,
  onIncomingChatMessage,
} from './chat-state';
import {
  activeIdentity,
  chatInboundTransfers,
  interfaceConfigurations,
  knownDestinations,
  localDestinationInventory,
  nomadBookmarks,
  nomadLinkStatuses,
  pathTableReady,
  pathTableEntries,
  propagationSyncActive,
  propagationSyncStatus,
  provisioningBookmarks,
  remoteDestinationInventory,
  reticulumLogs,
  reticulumRuntime,
} from './runtime';

type RuntimeInternals = {
  cancelChatMessageDelivery(messageId: string): Promise<boolean>;
  handleEvent(event: unknown): Promise<void>;
  queuePropagationFallback(message: unknown): void;
  expectedKnownIdentityInventoryStartupId?: string;
  knownDestinationPersistenceQueue: Promise<void>;
  worker?: { postMessage(command: unknown): void };
  platformInterfaceHost: {
    claimForMaintenance(interfaceId: string): Promise<void>;
    releaseFromMaintenance(interfaceId: string, config?: unknown): Promise<void>;
    resume(): Promise<void>;
  };
  provisioningRepository: {
    saveBookmark(bookmark: unknown): Promise<void>;
  };
  nomadRepository: {
    saveBookmark(bookmark: unknown): Promise<void>;
    replaceBookmark(previousId: string, bookmark: unknown): Promise<void>;
  };
  knownDestinationRepository: {
    save(record: unknown): Promise<void>;
    deleteMany(destinationHashes: readonly string[]): Promise<void>;
    delete(destinationHash: string): Promise<void>;
    clear(): Promise<void>;
  };
  chatRepository: {
    deleteMessages(ids: string[]): Promise<void>;
    replaceMessage(id: string, message: unknown): Promise<void>;
    saveMessage(message: unknown): Promise<void>;
  };
};

describe('ReticulumRuntimeController chat deletion', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    activeIdentity.set({
      id: 'identity-1',
      displayName: 'Test identity',
      identityHashHex: 'a'.repeat(32),
      publicKeyHex: 'b'.repeat(128),
    });
    chatMessages.set([]);
    chatInboundTransfers.set([]);
    interfaceConfigurations.set([]);
    blockedChatDestinations.set([]);
    provisioningBookmarks.set([]);
    nomadBookmarks.set([]);
    nomadLinkStatuses.set({});
    reticulumLogs.set([]);
    remoteDestinationInventory.set([]);
    localDestinationInventory.set([]);
    knownDestinations.set([]);
    pathTableReady.set(false);
    pathTableEntries.set([]);
    propagationSyncActive.set(false);
    propagationSyncStatus.set({ syncing: false });
    const internals = reticulumRuntime as unknown as RuntimeInternals;
    internals.worker = undefined;
    internals.expectedKnownIdentityInventoryStartupId = undefined;
    internals.knownDestinationPersistenceQueue = Promise.resolve();
  });

  it('claims and restores configured BLE RNode interfaces for local maintenance', async () => {
    const config = createRNodeInterfaceDraft('ble', 'ble-maintenance-interface');
    config.enabled = true;
    config.connection = { type: 'ble', deviceId: 'ble-device-1', deviceName: 'Pocket RNode' };
    interfaceConfigurations.set([config]);
    const internals = reticulumRuntime as unknown as RuntimeInternals;
    const claim = vi.spyOn(internals.platformInterfaceHost, 'claimForMaintenance').mockResolvedValue();
    const release = vi.spyOn(internals.platformInterfaceHost, 'releaseFromMaintenance').mockResolvedValue();

    await expect(reticulumRuntime.claimRNodeInterfaceForMaintenance(config.id)).resolves.toBe(true);
    expect(claim).toHaveBeenCalledWith(config.id);

    await expect(reticulumRuntime.releaseRNodeInterfaceFromMaintenance(config.id)).resolves.toBeUndefined();
    expect(release).toHaveBeenCalledWith(config.id, config);
  });

  it('forwards app resume to platform interface health checks', async () => {
    const internals = reticulumRuntime as unknown as RuntimeInternals;
    const resume = vi.spyOn(internals.platformInterfaceHost, 'resume').mockResolvedValue();

    await reticulumRuntime.resumePlatformInterfaces();

    expect(resume).toHaveBeenCalledOnce();
  });

  it('publishes successful automatic propagation sync results without publishing failures', async () => {
    const internals = reticulumRuntime as unknown as RuntimeInternals;
    const results: Array<{ received: number; duplicates: number }> = [];
    const unsubscribe = onAutomaticPropagationSyncComplete((result) => results.push(result));

    try {
      await internals.handleEvent({
        type: 'lxmfPropagationSyncResult',
        requestId: 'automatic:success',
        ok: true,
        received: 4,
        duplicates: 1,
        newMessages: 2,
      });
      await internals.handleEvent({
        type: 'lxmfPropagationSyncResult',
        requestId: 'automatic:failure',
        ok: false,
        code: 'LXMF_PROPAGATION_SYNC_NO_PATH',
      });
    } finally {
      unsubscribe();
    }

    expect(results).toEqual([{ received: 4, duplicates: 1, newMessages: 2 }]);
  });

  it('queues resume synchronization as an automatic propagation request', () => {
    const internals = reticulumRuntime as unknown as RuntimeInternals;
    const postMessage = vi.fn();
    internals.worker = { postMessage };

    expect(reticulumRuntime.requestAutomaticLxmfPropagationSync()).toBe(true);
    expect(postMessage).toHaveBeenCalledWith({
      type: 'syncLxmfPropagation',
      requestId: expect.stringMatching(/^automatic:resume:/),
    });

    propagationSyncActive.set(true);
    expect(reticulumRuntime.requestAutomaticLxmfPropagationSync()).toBe(false);
    expect(postMessage).toHaveBeenCalledOnce();
  });

  it('requires an explicit imported identity name without clearing the pending backup', async () => {
    const internals = reticulumRuntime as unknown as RuntimeInternals;
    const postMessage = vi.fn();
    internals.worker = { postMessage };
    const backup = {
      label: '',
      displayName: '',
      privateKey: new Uint8Array([1, 2, 3, 4]),
    };

    await expect(reticulumRuntime.importIdentity(backup, '   ')).resolves.toBe(false);
    expect(postMessage).not.toHaveBeenCalled();

    const operation = reticulumRuntime.importIdentity(backup, '  Travel  ');
    const command = postMessage.mock.calls[0][0] as {
      requestId: string;
      metadata: { label: string; displayName: string };
    };
    expect(command.metadata).toEqual(expect.objectContaining({
      label: 'Travel',
      displayName: 'Travel',
    }));
    expect(Array.from(backup.privateKey)).toEqual([1, 2, 3, 4]);

    await internals.handleEvent({
      type: 'identityOperationResult',
      requestId: command.requestId,
      ok: false,
    });
    await expect(operation).resolves.toBe(false);
  });

  it('publishes bounded propagation sync progress and transfer size', async () => {
    const internals = reticulumRuntime as unknown as RuntimeInternals;

    await internals.handleEvent({
      type: 'lxmfPropagationSyncStatus',
      syncing: true,
      state: 'receiving',
      progress: 1.5,
      transferSize: 4_096,
    });

    expect(get(propagationSyncActive)).toBe(true);
    expect(get(propagationSyncStatus)).toEqual({
      syncing: true,
      state: 'receiving',
      progress: 1,
      transferSize: 4_096,
    });

    await internals.handleEvent({
      type: 'lxmfPropagationSyncStatus',
      syncing: false,
    });
    expect(get(propagationSyncStatus)).toEqual({ syncing: false });
  });

  it('does not resolve propagation sync before received messages finish ingestion', async () => {
    const internals = reticulumRuntime as unknown as RuntimeInternals;
    const postMessage = vi.fn();
    internals.worker = { postMessage };
    let finishPersistence: (() => void) | undefined;
    vi.spyOn(internals.chatRepository, 'saveMessage').mockImplementation(() => (
      new Promise<void>((resolve) => { finishPersistence = resolve; })
    ));

    const sync = reticulumRuntime.syncLxmfPropagation();
    const command = postMessage.mock.calls[0][0] as { requestId: string };
    const received = internals.handleEvent({
      type: 'chatMessageReceived',
      identityId: 'identity-1',
      messageId: 'propagated-message',
      sourceHash: 'c'.repeat(32),
      destinationHash: 'a'.repeat(32),
      title: '',
      content: 'Arrived through propagation',
      method: 'propagated',
      receivedAt: '2026-08-03T10:00:00.000Z',
    });
    const completion = internals.handleEvent({
      type: 'lxmfPropagationSyncResult',
      requestId: command.requestId,
      ok: true,
      received: 1,
      duplicates: 0,
      newMessages: 1,
    });
    let resolved = false;
    void sync.then(() => { resolved = true; });

    await Promise.resolve();
    expect(get(chatMessages)).toEqual([
      expect.objectContaining({
        messageId: 'propagated-message',
        content: 'Arrived through propagation',
      }),
    ]);
    expect(resolved).toBe(false);

    finishPersistence?.();
    await received;
    await completion;
    await expect(sync).resolves.toEqual({ received: 1, duplicates: 0, newMessages: 1 });
    expect(resolved).toBe(true);
  });

  it('replaces a Nomad bookmark identity when its address changes', async () => {
    const internals = reticulumRuntime as unknown as RuntimeInternals;
    const replaceBookmark = vi.spyOn(internals.nomadRepository, 'replaceBookmark')
      .mockResolvedValue(undefined);
    const previousId = 'identity-1:bookmark';
    nomadBookmarks.set([{
      id: previousId,
      identityId: 'identity-1',
      destinationHash: 'a'.repeat(32),
      path: '/start',
      identificationPolicy: 'never',
      label: 'Old name',
      createdAt: '2026-07-16T10:00:00.000Z',
    }]);
    const editedAddress = `${'b'.repeat(32)}:/page/edited.mu\`c=heap`;

    expect(await reticulumRuntime.updateNomadBookmark(
      previousId,
      editedAddress,
      '  New name  ',
      'bookmark',
    )).toBe(true);

    const updated = expect.objectContaining({
      id: `identity-1:${editedAddress}`,
      identityId: 'identity-1',
      destinationHash: 'b'.repeat(32),
      path: '/page/edited.mu',
      requestData: { var_c: 'heap' },
      identificationPolicy: 'bookmark',
      label: 'New name',
    });
    expect(replaceBookmark).toHaveBeenCalledWith(previousId, updated);
    expect(get(nomadBookmarks)).toEqual([updated]);

    expect(await reticulumRuntime.updateNomadBookmark(
      `identity-1:${editedAddress}`,
      editedAddress,
      '   ',
      'never',
    )).toBe(false);
    expect(replaceBookmark).toHaveBeenCalledOnce();
  });

  it('rejects a Nomad bookmark without a name', async () => {
    const internals = reticulumRuntime as unknown as RuntimeInternals;
    const saveBookmark = vi.spyOn(internals.nomadRepository, 'saveBookmark')
      .mockResolvedValue(undefined);

    expect(await reticulumRuntime.addNomadBookmark(
      `${'a'.repeat(32)}:/page/index.mu`,
      '   ',
    )).toBe(false);
    expect(saveBookmark).not.toHaveBeenCalled();
  });

  it('stores unified observations from every recognized application in the global directory', async () => {
    const internals = reticulumRuntime as unknown as RuntimeInternals;
    vi.spyOn(internals.knownDestinationRepository, 'save').mockResolvedValue(undefined);
    const nomadHash = '1'.repeat(32);
    const chatHash = '2'.repeat(32);

    await internals.handleEvent({
      type: 'knownDestinationObserved',
      destinationHash: nomadHash,
      fullDestinationName: 'nomadnetwork.node',
      displayName: 'Forest node',
      lastAnnouncedAt: '2026-07-24T10:00:00.000Z',
      metadata: {},
    });
    await internals.handleEvent({
      type: 'knownDestinationObserved',
      destinationHash: chatHash,
      fullDestinationName: 'lxmf.delivery',
      displayName: 'Shared peer',
      lastAnnouncedAt: '2026-07-24T10:01:00.000Z',
      metadata: { stampCost: 8 },
    });
    await internals.handleEvent({
      type: 'knownDestinationObserved',
      destinationHash: nomadHash,
      fullDestinationName: 'nomadnetwork.node',
      displayName: 'Stale name',
      lastAnnouncedAt: '2026-07-24T09:00:00.000Z',
      metadata: {},
    });

    expect(get(knownDestinations)).toEqual([
      expect.objectContaining({ destinationHash: chatHash, displayName: 'Shared peer' }),
      expect.objectContaining({ destinationHash: nomadHash, displayName: 'Forest node' }),
    ]);
    expect(internals.knownDestinationRepository.save).toHaveBeenCalledTimes(3);
  });

  it('prunes enrichment only from the matching complete startup identity inventory', async () => {
    const internals = reticulumRuntime as unknown as RuntimeInternals;
    const deleteMany = vi.spyOn(internals.knownDestinationRepository, 'deleteMany')
      .mockResolvedValue(undefined);
    const retainedHash = '3'.repeat(32);
    const removedHash = '4'.repeat(32);
    knownDestinations.set([
      { destinationHash: retainedHash, displayName: 'Retained peer' },
      { destinationHash: removedHash, displayName: 'Removed peer' },
    ]);

    await internals.handleEvent({
      type: 'pathManagementSnapshot',
      paths: [],
      remoteDestinations: [
        { destinationHash: retainedHash, fullDestinationName: 'lxmf.delivery' },
      ],
      localDestinations: [{
        destinationHash: '5'.repeat(32),
        fullDestinationName: 'lxmf.delivery',
      }],
    });
    expect(get(pathTableReady)).toBe(true);
    expect(get(knownDestinations)).toHaveLength(2);
    expect(get(remoteDestinationInventory)).toEqual([
      { destinationHash: retainedHash, fullDestinationName: 'lxmf.delivery' },
    ]);
    expect(get(localDestinationInventory)).toEqual([{
      destinationHash: '5'.repeat(32),
      fullDestinationName: 'lxmf.delivery',
    }]);
    expect(deleteMany).not.toHaveBeenCalled();

    internals.expectedKnownIdentityInventoryStartupId = 'current-startup';
    await internals.handleEvent({
      type: 'knownIdentityInventoryReady',
      startupId: 'stale-startup',
      destinationHashes: [],
    });
    expect(get(knownDestinations)).toHaveLength(2);

    await internals.handleEvent({
      type: 'knownIdentityInventoryReady',
      startupId: 'current-startup',
      destinationHashes: [retainedHash],
    });
    expect(get(knownDestinations)).toEqual([{
      destinationHash: retainedHash,
      displayName: 'Retained peer',
    }]);
    expect(deleteMany).toHaveBeenCalledOnce();
    expect(deleteMany).toHaveBeenCalledWith([removedHash]);

    await internals.handleEvent({
      type: 'knownIdentityInventoryReady',
      startupId: 'current-startup',
      destinationHashes: [],
    });
    expect(get(knownDestinations)).toHaveLength(1);
    expect(deleteMany).toHaveBeenCalledOnce();
  });

  it('serializes startup pruning before a concurrent announce save', async () => {
    const internals = reticulumRuntime as unknown as RuntimeInternals;
    const retainedHash = '5'.repeat(32);
    const announcedHash = '6'.repeat(32);
    let finishDelete = () => {};
    const deletePending = new Promise<void>((resolve) => {
      finishDelete = resolve;
    });
    const deleteMany = vi.spyOn(internals.knownDestinationRepository, 'deleteMany')
      .mockReturnValue(deletePending);
    const save = vi.spyOn(internals.knownDestinationRepository, 'save')
      .mockResolvedValue(undefined);
    knownDestinations.set([
      { destinationHash: retainedHash, displayName: 'Retained peer' },
      { destinationHash: announcedHash, displayName: 'Old name' },
    ]);
    internals.expectedKnownIdentityInventoryStartupId = 'startup';

    const pruning = internals.handleEvent({
      type: 'knownIdentityInventoryReady',
      startupId: 'startup',
      destinationHashes: [retainedHash],
    });
    await Promise.resolve();
    expect(deleteMany).toHaveBeenCalledWith([announcedHash]);

    const observing = internals.handleEvent({
      type: 'knownDestinationObserved',
      destinationHash: announcedHash,
      fullDestinationName: 'lxmf.delivery',
      displayName: 'Fresh name',
      lastAnnouncedAt: '2026-07-29T20:00:00.000Z',
    });
    await Promise.resolve();
    expect(save).not.toHaveBeenCalled();

    finishDelete();
    await Promise.all([pruning, observing]);
    expect(save).toHaveBeenCalledOnce();
    expect(get(knownDestinations)).toContainEqual(expect.objectContaining({
      destinationHash: announcedHash,
      displayName: 'Fresh name',
    }));
  });

  it('returns the destination only after the worker verifies and imports an LXMA peer', async () => {
    const internals = reticulumRuntime as unknown as RuntimeInternals;
    const postMessage = vi.fn();
    internals.worker = { postMessage };
    const uri = `lxma://${'7'.repeat(32)}:${'8'.repeat(128)}`;

    const pending = reticulumRuntime.importLxmaPeer(uri);
    const command = postMessage.mock.calls[0][0] as { requestId: string };
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'importLxmaPeer', uri }));

    await internals.handleEvent({
      type: 'lxmaPeerImportResult',
      requestId: command.requestId,
      ok: true,
      destinationHash: '7'.repeat(32),
    });

    await expect(pending).resolves.toBe('7'.repeat(32));
  });

  it('sends a named raw probe and resolves with proof RTT details', async () => {
    const internals = reticulumRuntime as unknown as RuntimeInternals;
    const postMessage = vi.fn();
    internals.worker = { postMessage };
    const destinationHash = '9'.repeat(32);

    const pending = reticulumRuntime.probeDestination(destinationHash, 'lxmf.delivery', 12_000, 16);
    const command = postMessage.mock.calls[0][0] as { requestId: string };
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'probeDestination',
      destinationHash,
      fullDestinationName: 'lxmf.delivery',
      timeoutMs: 12_000,
      probeSizeBytes: 16,
    }));

    await internals.handleEvent({
      type: 'probeResult',
      requestId: command.requestId,
      ok: true,
      destinationHash,
      fullDestinationName: 'lxmf.delivery',
      probeSizeBytes: 16,
      roundTripTimeMs: 42.5,
      hops: 2,
      viaHash: '8'.repeat(32),
      interfaceName: 'Home RNode',
      interfaceType: 'rnode',
    });

    await expect(pending).resolves.toEqual(expect.objectContaining({
      ok: true,
      destinationHash,
      fullDestinationName: 'lxmf.delivery',
      probeSizeBytes: 16,
      roundTripTimeMs: 42.5,
      hops: 2,
      viaHash: '8'.repeat(32),
      interfaceName: 'Home RNode',
      interfaceType: 'rnode',
    }));
  });

  it('cancels a pending raw probe through the worker', async () => {
    const internals = reticulumRuntime as unknown as RuntimeInternals;
    const postMessage = vi.fn();
    internals.worker = { postMessage };
    const destinationHash = '6'.repeat(32);
    const controller = new AbortController();

    const pending = reticulumRuntime.probeDestination(
      destinationHash,
      'lxmf.delivery',
      20_000,
      8,
      controller.signal,
    );
    const command = postMessage.mock.calls[0][0] as { requestId: string };
    controller.abort();

    expect(postMessage).toHaveBeenLastCalledWith({ type: 'cancelProbe', requestId: command.requestId });
    await expect(pending).resolves.toEqual({
      ok: false,
      destinationHash,
      fullDestinationName: 'lxmf.delivery',
      probeSizeBytes: 8,
      code: 'PROBE_CANCELLED',
    });
  });

  it('rejects invalid probes without posting to the worker', async () => {
    const internals = reticulumRuntime as unknown as RuntimeInternals;
    const postMessage = vi.fn();
    internals.worker = { postMessage };

    await expect(reticulumRuntime.probeDestination('invalid', 'lxmf..delivery', 0, 501)).resolves.toEqual({
      ok: false,
      destinationHash: 'invalid',
      fullDestinationName: 'lxmf..delivery',
      probeSizeBytes: 501,
      code: 'PROBE_INVALID',
    });
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('drops a destination path through the worker and tracks the worker inventory', async () => {
    const internals = reticulumRuntime as unknown as RuntimeInternals;
    const postMessage = vi.fn();
    internals.worker = { postMessage };
    const destinationHash = '3'.repeat(32);

    await internals.handleEvent({
      type: 'pathManagementSnapshot',
      paths: [],
      remoteDestinations: [{ destinationHash }],
      localDestinations: [],
    });
    expect(get(remoteDestinationInventory)).toEqual([{ destinationHash }]);

    const pending = reticulumRuntime.dropDestinationPath(destinationHash);
    const command = postMessage.mock.calls[0][0] as { requestId: string };
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'dropDestinationPath',
      destinationHash,
    }));

    await internals.handleEvent({ type: 'destinationPathDropResult', requestId: command.requestId, ok: true });
    await expect(pending).resolves.toBe(true);
  });

  it('drops multiple destination paths with one worker operation', async () => {
    const internals = reticulumRuntime as unknown as RuntimeInternals;
    const postMessage = vi.fn();
    internals.worker = { postMessage };
    const firstDestination = '3'.repeat(32);
    const secondDestination = '4'.repeat(32);

    const pending = reticulumRuntime.dropDestinationPaths([
      firstDestination,
      secondDestination,
      firstDestination,
    ]);
    const command = postMessage.mock.calls[0][0] as { requestId: string };
    expect(postMessage).toHaveBeenCalledWith({
      type: 'dropDestinationPaths',
      requestId: command.requestId,
      destinationHashes: [firstDestination, secondDestination],
    });

    await internals.handleEvent({
      type: 'pathManagementOperationResult',
      requestId: command.requestId,
      ok: true,
      count: 2,
    });
    await expect(pending).resolves.toEqual({ ok: true, count: 2 });
  });

  it('tracks path-management details and routes request, clear, and forget operations through the worker', async () => {
    const internals = reticulumRuntime as unknown as RuntimeInternals;
    const postMessage = vi.fn();
    internals.worker = { postMessage };
    vi.spyOn(internals.knownDestinationRepository, 'delete').mockResolvedValue(undefined);
    vi.spyOn(internals.knownDestinationRepository, 'clear').mockResolvedValue(undefined);
    const destinationHash = '4'.repeat(32);

    await internals.handleEvent({
      type: 'pathManagementSnapshot',
      paths: [{
        destinationHash,
        hops: 3,
        nextHop: '5'.repeat(32),
        interfaceId: 'interface-1',
        expiresAt: '2026-07-24T10:00:00.000Z',
        lastAnnouncedAt: '2026-07-17T10:00:00.000Z',
      }],
      remoteDestinations: [{
        destinationHash,
        publicKey: '6'.repeat(128),
        lastAnnouncedAt: '2026-07-23T10:00:00.000Z',
      }],
      localDestinations: [],
    });
    expect(get(pathTableEntries)).toEqual([expect.objectContaining({
      destinationHash,
      hops: 3,
      lastAnnouncedAt: '2026-07-17T10:00:00.000Z',
    })]);
    expect(get(remoteDestinationInventory)).toEqual([expect.objectContaining({
      destinationHash,
      publicKey: '6'.repeat(128),
    })]);

    const pathRequest = reticulumRuntime.requestDestinationPath(destinationHash);
    const operations = [
      reticulumRuntime.clearDestinationPaths(),
      reticulumRuntime.forgetKnownDestination(destinationHash),
      reticulumRuntime.clearKnownDestinations(),
    ];
    expect(postMessage.mock.calls.map(([command]) => (command as { type: string }).type)).toEqual([
      'requestDestinationPath',
      'clearDestinationPaths',
      'forgetKnownDestination',
      'clearKnownDestinations',
    ]);
    const [requestCommand, ...managementCommands] = postMessage.mock.calls.map(([command]) => (
      command as { requestId: string }
    ));
    await internals.handleEvent({
      type: 'destinationPathRequestResult',
      requestId: requestCommand.requestId,
      ok: true,
      destinationHash,
      hops: 3,
    });
    await expect(pathRequest).resolves.toEqual({
      ok: true,
      destinationHash,
      hops: 3,
    });
    for (const command of managementCommands) {
      await internals.handleEvent({
        type: 'pathManagementOperationResult',
        requestId: command.requestId,
        ok: true,
      });
    }
    await expect(Promise.all(operations)).resolves.toEqual([true, true, true]);
  });

  it('cancels a pending destination path request through the worker', async () => {
    const internals = reticulumRuntime as unknown as RuntimeInternals;
    const postMessage = vi.fn();
    internals.worker = { postMessage };
    const destinationHash = '7'.repeat(32);
    const controller = new AbortController();

    const pending = reticulumRuntime.requestDestinationPath(destinationHash, controller.signal);
    const request = postMessage.mock.calls[0][0] as { requestId: string };
    controller.abort();

    expect(postMessage).toHaveBeenLastCalledWith({
      type: 'cancelDestinationPathRequest',
      requestId: request.requestId,
    });
    await expect(pending).resolves.toEqual({
      ok: false,
      destinationHash,
      code: 'PATH_REQUEST_CANCELLED',
    });
  });

  it('does not duplicate detailed worker logs for NomadNet page failures', async () => {
    reticulumLogs.set([{
      id: 'worker-timeout',
      timestamp: '2026-07-19T17:43:45.000Z',
      level: 'warning',
      source: 'wasm',
      code: 'NOMAD_REQUEST_TIMEOUT',
      details: {
        destinationHash: 'f'.repeat(32),
        path: '/page/index.mu',
      },
    }]);
    const internals = reticulumRuntime as unknown as RuntimeInternals;

    await internals.handleEvent({
      type: 'nomadPageFailed',
      requestId: 'nomad-request',
      code: 'NOMAD_REQUEST_TIMEOUT',
    });

    expect(get(reticulumLogs)).toEqual([expect.objectContaining({
      id: 'worker-timeout',
      source: 'wasm',
      code: 'NOMAD_REQUEST_TIMEOUT',
    })]);
  });

  it('asks the worker to discover an unknown NomadNet destination before failing', async () => {
    const internals = reticulumRuntime as unknown as RuntimeInternals;
    const postMessage = vi.fn();
    internals.worker = { postMessage };
    const destinationHash = '6'.repeat(32);
    const onUpdate = vi.fn();

    const pending = reticulumRuntime.requestNomadPage(
      destinationHash,
      '/page/index.mu',
      {},
      onUpdate,
    );
    const command = postMessage.mock.calls[0][0] as { requestId: string; publicKey?: string };

    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'requestNomadPage',
      destinationHash,
      path: '/page/index.mu',
    }));
    expect(command).not.toHaveProperty('publicKey');
    expect(onUpdate).not.toHaveBeenCalled();

    await internals.handleEvent({
      type: 'nomadPageFailed',
      requestId: command.requestId,
      code: 'NOMAD_DESTINATION_UNKNOWN',
    });
    await expect(pending).resolves.toBeUndefined();
    expect(onUpdate).toHaveBeenCalledWith({ type: 'failed', code: 'NOMAD_DESTINATION_UNKNOWN' });
  });

  it('establishes a NomadNet link without requesting a page', async () => {
    const internals = reticulumRuntime as unknown as RuntimeInternals;
    const postMessage = vi.fn();
    internals.worker = { postMessage };
    const destinationHash = '3'.repeat(32);

    const pending = reticulumRuntime.establishNomadLink(destinationHash);
    const command = postMessage.mock.calls[0][0] as { requestId: string };

    expect(postMessage).toHaveBeenCalledWith({
      type: 'establishNomadLink',
      requestId: command.requestId,
      destinationHash,
    });
    expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({
      type: 'requestNomadPage',
    }));

    await internals.handleEvent({
      type: 'nomadLinkResult',
      requestId: command.requestId,
      ok: true,
    });
    await expect(pending).resolves.toBe(true);
  });

  it('tracks authoritative NomadNet link status changes from the worker', async () => {
    const internals = reticulumRuntime as unknown as RuntimeInternals;
    const destinationHash = '4'.repeat(32);

    await internals.handleEvent({
      type: 'nomadLinkStatusChanged',
      destinationHash,
      active: true,
      identified: true,
    });
    expect(get(nomadLinkStatuses)[destinationHash]).toEqual({ active: true, identified: true });

    await internals.handleEvent({
      type: 'nomadLinkStatusChanged',
      destinationHash,
      active: false,
      identified: false,
    });
    expect(get(nomadLinkStatuses)[destinationHash]).toEqual({ active: false, identified: false });
  });

  it('leaves NomadNet identity lookup to the worker after the active identity changes', async () => {
    const internals = reticulumRuntime as unknown as RuntimeInternals;
    const postMessage = vi.fn();
    internals.worker = { postMessage };
    const destinationHash = '2'.repeat(32);
    knownDestinations.set([{
      destinationHash,
      fullDestinationName: 'nomadnetwork.node',
      lastAnnouncedAt: '2026-07-22T10:00:00.000Z',
    }]);
    activeIdentity.set({
      id: 'identity-2',
      displayName: 'Second identity',
      identityHashHex: '4'.repeat(32),
      publicKeyHex: '5'.repeat(128),
    });

    const pending = reticulumRuntime.requestNomadPage(destinationHash, '/page/index.mu');
    const command = postMessage.mock.calls[0][0] as { requestId: string };

    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'requestNomadPage',
      destinationHash,
    }));
    expect(postMessage.mock.calls[0][0]).not.toHaveProperty('publicKey');
    await internals.handleEvent({
      type: 'nomadPageFailed',
      requestId: command.requestId,
      code: 'NOMAD_REQUEST_TIMEOUT',
    });
    await expect(pending).resolves.toBeUndefined();
  });

  it('lets the worker discover an unannounced provisioning destination public key', async () => {
    const internals = reticulumRuntime as unknown as RuntimeInternals;
    const postMessage = vi.fn();
    internals.worker = { postMessage };
    const destinationHash = '5'.repeat(32);

    const pending = reticulumRuntime.requestProvisioning({
      id: destinationHash,
      destinationHash,
      lastAnnouncedAt: '2026-07-21T10:00:00.000Z',
    }, Uint8Array.of(1), true);
    const command = postMessage.mock.calls[0][0] as { requestId: string; publicKey?: string };

    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'requestProvisioning',
      destinationHash,
    }));
    expect(command).not.toHaveProperty('publicKey');

    await internals.handleEvent({
      type: 'provisioningResponse',
      requestId: command.requestId,
      data: Uint8Array.of(2),
    });
    await expect(pending).resolves.toEqual(Uint8Array.of(2));
  });

  it('persists a bookmark for an unannounced provisioning destination', async () => {
    const internals = reticulumRuntime as unknown as RuntimeInternals;
    const saveBookmark = vi.spyOn(internals.provisioningRepository, 'saveBookmark').mockResolvedValue();
    const destinationHash = '4'.repeat(32);

    await expect(reticulumRuntime.saveProvisioningNodeBookmark({
      id: destinationHash,
      destinationHash,
      lastAnnouncedAt: '2026-07-21T10:00:00.000Z',
    }, '  Custom router  ')).resolves.toBe(true);

    expect(saveBookmark).toHaveBeenCalledWith(expect.objectContaining({
      id: destinationHash,
      destinationHash,
      label: 'Custom router',
    }));
    expect(get(provisioningBookmarks)).toEqual([
      expect.objectContaining({ destinationHash, label: 'Custom router' }),
    ]);

    await expect(reticulumRuntime.saveProvisioningNodeBookmark({
      id: destinationHash,
      destinationHash,
      lastAnnouncedAt: '2026-07-21T10:00:00.000Z',
    }, '   ')).resolves.toBe(false);
    expect(saveBookmark).toHaveBeenCalledOnce();
  });

  it('asks the worker to close every provisioning link', () => {
    const internals = reticulumRuntime as unknown as RuntimeInternals;
    const postMessage = vi.fn();
    internals.worker = { postMessage };

    reticulumRuntime.closeProvisioning();

    expect(postMessage).toHaveBeenCalledWith({ type: 'closeProvisioning' });
  });

  it('cancels every pending outbound message before deleting the conversation', async () => {
    const destinationHash = 'c'.repeat(32);
    const otherDestination = 'd'.repeat(32);
    chatMessages.set([{
      id: 'identity-1:queued',
      identityId: 'identity-1',
      messageId: 'queued',
      sourceHash: 'e'.repeat(32),
      destinationHash,
      title: '',
      content: 'Queued',
      direction: 'outgoing',
      status: 'queued',
      receivedAt: '2026-07-16T10:00:00.000Z',
    }, {
      id: 'identity-1:sending',
      identityId: 'identity-1',
      messageId: 'sending',
      sourceHash: 'e'.repeat(32),
      destinationHash,
      title: '',
      content: 'Sending',
      direction: 'outgoing',
      status: 'sending',
      receivedAt: '2026-07-16T10:01:00.000Z',
    }, {
      id: 'identity-1:incoming',
      identityId: 'identity-1',
      messageId: 'incoming',
      sourceHash: destinationHash,
      destinationHash: 'e'.repeat(32),
      title: '',
      content: 'Incoming',
      direction: 'incoming',
      status: 'delivered',
      receivedAt: '2026-07-16T10:02:00.000Z',
    }, {
      id: 'identity-1:other',
      identityId: 'identity-1',
      messageId: 'other',
      sourceHash: 'e'.repeat(32),
      destinationHash: otherDestination,
      title: '',
      content: 'Keep',
      direction: 'outgoing',
      status: 'delivered',
      receivedAt: '2026-07-16T10:03:00.000Z',
    }]);
    const internals = reticulumRuntime as unknown as RuntimeInternals;
    const cancel = vi.spyOn(internals, 'cancelChatMessageDelivery').mockResolvedValue(true);
    const remove = vi.spyOn(internals.chatRepository, 'deleteMessages').mockResolvedValue();

    await expect(reticulumRuntime.deleteChatConversation(destinationHash)).resolves.toBe(true);

    expect(cancel).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenCalledWith('queued');
    expect(cancel).toHaveBeenCalledWith('sending');
    expect(new Set(remove.mock.calls[0][0])).toEqual(new Set([
      'identity-1:queued',
      'identity-1:sending',
      'identity-1:incoming',
    ]));
    expect(get(chatMessages).map((message) => message.messageId)).toEqual(['other']);
  });

  it('aborts a pending delivery without deleting its persisted message', async () => {
    const destinationHash = 'c'.repeat(32);
    chatMessages.set([{
      id: 'identity-1:abort-pending',
      identityId: 'identity-1',
      messageId: 'abort-pending',
      sourceHash: 'e'.repeat(32),
      destinationHash,
      title: '',
      content: 'Keep after abort',
      direction: 'outgoing',
      status: 'sending',
      progress: 0.4,
      propagationFallbackPending: true,
      receivedAt: '2026-07-16T10:00:00.000Z',
    }]);
    const internals = reticulumRuntime as unknown as RuntimeInternals;
    const cancel = vi.spyOn(internals, 'cancelChatMessageDelivery').mockResolvedValue(true);
    const persist = vi.spyOn(internals.chatRepository, 'saveMessage').mockResolvedValue();

    await expect(reticulumRuntime.abortChatMessage('abort-pending')).resolves.toBe(true);

    expect(cancel).toHaveBeenCalledWith('abort-pending');
    expect(get(chatMessages)).toEqual([expect.objectContaining({
      messageId: 'abort-pending',
      status: 'failed',
      progress: undefined,
      propagationFallbackPending: false,
    })]);
    expect(persist).toHaveBeenCalledWith(expect.objectContaining({
      messageId: 'abort-pending',
      status: 'failed',
    }));
  });

  it('does not start propagation fallback after an explicit cancellation', async () => {
    chatMessages.set([{
      id: 'identity-1:cancelled',
      identityId: 'identity-1',
      messageId: 'cancelled',
      sourceHash: 'e'.repeat(32),
      destinationHash: 'c'.repeat(32),
      title: '',
      content: 'Cancelled delivery',
      direction: 'outgoing',
      status: 'sending',
      representation: 'directResource',
      progress: 0.7,
      propagationFallbackPending: true,
      receivedAt: '2026-07-16T10:00:00.000Z',
    }]);
    const internals = reticulumRuntime as unknown as RuntimeInternals;
    const fallback = vi.spyOn(internals, 'queuePropagationFallback');
    vi.spyOn(internals.chatRepository, 'saveMessage').mockResolvedValue();

    await internals.handleEvent({
      type: 'chatMessageState',
      identityId: 'identity-1',
      messageId: 'cancelled',
      state: 'cancelled',
    });

    expect(get(chatMessages)[0]).toMatchObject({
      status: 'failed',
      progress: undefined,
      propagationFallbackPending: false,
    });
    expect(fallback).not.toHaveBeenCalled();
  });

  it('persists the first available route snapshot with outbound progress', async () => {
    const destinationHash = 'c'.repeat(32);
    chatMessages.set([{
      id: 'identity-1:path-progress',
      identityId: 'identity-1',
      messageId: 'path-progress',
      sourceHash: 'e'.repeat(32),
      destinationHash,
      title: '',
      content: 'Capture route',
      direction: 'outgoing',
      status: 'queued',
      receivedAt: '2026-07-16T10:00:00.000Z',
    }]);
    const internals = reticulumRuntime as unknown as RuntimeInternals;
    const persist = vi.spyOn(internals.chatRepository, 'saveMessage').mockResolvedValue();
    const path = {
      hops: 3,
      interfaceId: 'community-hub',
      interfaceName: 'Community Hub',
      interfaceType: 'websocket',
    };

    await internals.handleEvent({
      type: 'chatMessageProgress',
      identityId: 'identity-1',
      messageId: 'path-progress',
      state: 'sending',
      method: 'direct',
      representation: 'directPacket',
      attempts: 1,
      maxAttempts: 5,
      progress: 0.5,
      stamp: { status: 'calculated', cost: 12 },
      path,
    });

    expect(get(chatMessages)[0]).toMatchObject({
      attempts: 1,
      stamp: { status: 'calculated', cost: 12 },
      path,
    });
    expect(persist).toHaveBeenCalledWith(expect.objectContaining({ path }));
  });

  it('keeps live outbound progress sending while its attempt counter advances', async () => {
    const destinationHash = 'c'.repeat(32);
    chatMessages.set([{
      id: 'identity-1:retry-progress',
      identityId: 'identity-1',
      messageId: 'retry-progress',
      sourceHash: 'e'.repeat(32),
      destinationHash,
      title: '',
      content: 'Retry status',
      direction: 'outgoing',
      status: 'queued',
      receivedAt: '2026-07-16T10:00:00.000Z',
    }]);
    const internals = reticulumRuntime as unknown as RuntimeInternals;
    vi.spyOn(internals.chatRepository, 'saveMessage').mockResolvedValue();
    const progress = (state: string, attempts: number) => internals.handleEvent({
      type: 'chatMessageProgress',
      identityId: 'identity-1',
      messageId: 'retry-progress',
      state,
      method: 'direct',
      representation: 'directPacket',
      attempts,
      maxAttempts: 5,
      progress: 0.01,
    });

    await progress('outbound', 0);
    expect(get(chatMessages)[0]).toMatchObject({ status: 'sending', attempts: 0 });

    await progress('sending', 0);
    expect(get(chatMessages)[0]).toMatchObject({ status: 'sending', attempts: 0 });

    await progress('outbound', 0);
    expect(get(chatMessages)[0]).toMatchObject({ status: 'sending', attempts: 0 });

    await progress('outbound', 1);
    expect(get(chatMessages)[0]).toMatchObject({ status: 'sending', attempts: 1 });

    await progress('sending', 1);
    expect(get(chatMessages)[0]).toMatchObject({ status: 'sending', attempts: 1 });
  });

  it('marks the replacement delivery as an explicit propagation fallback', async () => {
    const destinationHash = 'c'.repeat(32);
    chatMessages.set([{
      id: 'identity-1:failed-direct',
      identityId: 'identity-1',
      messageId: 'failed-direct',
      sourceHash: 'e'.repeat(32),
      destinationHash,
      title: '',
      content: 'Fallback status',
      direction: 'outgoing',
      status: 'failed',
      method: 'direct',
      receivedAt: '2026-07-16T10:00:00.000Z',
    }]);
    const internals = reticulumRuntime as unknown as RuntimeInternals;
    const replace = vi.spyOn(internals.chatRepository, 'replaceMessage').mockResolvedValue();

    await internals.handleEvent({
      type: 'chatMessageQueued',
      requestId: 'fallback-request',
      identityId: 'identity-1',
      messageId: 'propagated-replacement',
      sourceHash: 'e'.repeat(32),
      destinationHash,
      title: '',
      content: 'Fallback status',
      method: 'propagated',
      propagationFallback: true,
      propagationFallbackPending: false,
      replacesMessageId: 'failed-direct',
      timestamp: 1_752_660_000,
      queuedAt: '2026-07-16T10:01:00.000Z',
    });

    expect(get(chatMessages)).toEqual([expect.objectContaining({
      messageId: 'propagated-replacement',
      method: 'propagated',
      status: 'queued',
      propagationFallback: true,
      propagationFallbackPending: false,
    })]);
    expect(replace).toHaveBeenCalledWith(
      'identity-1:failed-direct',
      expect.objectContaining({ propagationFallback: true }),
    );
  });

  it('persists a block and cancels pending outbound deliveries for that destination', async () => {
    const destinationHash = 'c'.repeat(32);
    chatMessages.set([{
      id: 'identity-1:pending',
      identityId: 'identity-1',
      messageId: 'pending',
      sourceHash: 'e'.repeat(32),
      destinationHash,
      title: '',
      content: 'Pending',
      direction: 'outgoing',
      status: 'sending',
      receivedAt: '2026-07-16T10:00:00.000Z',
    }]);
    const internals = reticulumRuntime as unknown as RuntimeInternals & {
      chatRepository: RuntimeInternals['chatRepository'] & {
        saveBlockedDestination(value: unknown): Promise<void>;
      };
    };
    const cancel = vi.spyOn(internals, 'cancelChatMessageDelivery').mockResolvedValue(true);
    vi.spyOn(internals.chatRepository, 'saveBlockedDestination').mockResolvedValue();
    const originalWorker = internals.worker;
    internals.worker = {
      postMessage(command: unknown) {
        const policy = command as { type?: string; requestId?: string };
        if (policy.type !== 'setLxmfIgnoredDestinations' || !policy.requestId) return;
        queueMicrotask(() => void internals.handleEvent({
          type: 'lxmfIgnoredDestinationsResult',
          requestId: policy.requestId,
          ok: true,
        }));
      },
    };
    try {
      await expect(reticulumRuntime.blockChatDestination(destinationHash)).resolves.toBe(true);

      expect(cancel).toHaveBeenCalledWith('pending');
      expect(reticulumRuntime.isChatDestinationBlocked(destinationHash)).toBe(true);
    } finally {
      internals.worker = originalWorker;
    }
  });

  it('rejects outbound messages and discards inbound messages for a blocked destination', async () => {
    const destinationHash = 'f'.repeat(32);
    blockedChatDestinations.set([{
      id: `identity-1:${destinationHash}`,
      identityId: 'identity-1',
      destinationHash,
      blockedAt: '2026-07-16T10:00:00.000Z',
    }]);
    const internals = reticulumRuntime as unknown as RuntimeInternals;
    const originalWorker = internals.worker;
    const postMessage = vi.fn();
    internals.worker = { postMessage };
    const persist = vi.spyOn(internals.chatRepository, 'saveMessage').mockResolvedValue();
    try {
      await expect(reticulumRuntime.sendChatMessage(destinationHash, 'Do not send')).resolves.toEqual({
        ok: false,
        code: 'LXMF_DESTINATION_BLOCKED',
      });
      expect(postMessage).not.toHaveBeenCalled();

      await internals.handleEvent({
        type: 'chatMessageReceived',
        identityId: 'identity-1',
        messageId: 'blocked-inbound',
        sourceHash: destinationHash,
        destinationHash: 'a'.repeat(32),
        title: '',
        content: 'Do not accept',
        receivedAt: '2026-07-16T10:01:00.000Z',
      });
      expect(get(chatMessages)).toEqual([]);
      expect(persist).not.toHaveBeenCalled();
    } finally {
      internals.worker = originalWorker;
    }
  });

  it('emits one foreground event for a newly received message and ignores a duplicate', async () => {
    const sourceHash = 'e'.repeat(32);
    const received = vi.fn();
    const unsubscribe = onIncomingChatMessage(received);
    const internals = reticulumRuntime as unknown as RuntimeInternals;
    vi.spyOn(internals.chatRepository, 'saveMessage').mockResolvedValue();
    const event = {
      type: 'chatMessageReceived',
      identityId: 'identity-1',
      messageId: 'new-inbound',
      sourceHash,
      destinationHash: 'a'.repeat(32),
      title: '',
      content: 'New message',
      method: 'direct',
      verification: 'valid',
      stamp: { status: 'requiredAccepted', cost: 12 },
      timestamp: 1_753_525_200,
      receivedAt: '2026-07-26T10:01:00.000Z',
      path: {
        hops: 2,
        interfaceId: 'rnode-home',
        interfaceName: 'Home RNode',
        interfaceType: 'rnode',
      },
    };

    try {
      await internals.handleEvent(event);
      await internals.handleEvent(event);

      expect(received).toHaveBeenCalledOnce();
      expect(received).toHaveBeenCalledWith(expect.objectContaining({
        id: 'identity-1:new-inbound',
        sourceHash,
        direction: 'incoming',
        method: 'direct',
        verification: 'valid',
        stamp: { status: 'requiredAccepted', cost: 12 },
        path: expect.objectContaining({
          hops: 2,
          interfaceName: 'Home RNode',
          interfaceType: 'rnode',
        }),
      }));
    } finally {
      unsubscribe();
    }
  });

  it('queues and persists an attachment-only message without losing its binary data', async () => {
    const destinationHash = 'd'.repeat(32);
    const attachment = {
      kind: 'file' as const,
      name: 'notes.txt',
      mimeType: 'text/plain',
      data: new Uint8Array([1, 2, 3]),
    };
    const internals = reticulumRuntime as unknown as RuntimeInternals;
    const originalWorker = internals.worker;
    let posted: Record<string, unknown> | undefined;
    internals.worker = {
      postMessage(command: unknown) {
        posted = command as Record<string, unknown>;
        const requestId = posted.requestId;
        queueMicrotask(() => void internals.handleEvent({
          type: 'chatMessageQueued',
          requestId,
          identityId: 'identity-1',
          messageId: 'message-with-file',
          sourceHash: 'a'.repeat(32),
          destinationHash,
          title: '',
          content: '',
          attachments: [attachment],
          method: 'direct',
          propagationFallback: false,
          propagationFallbackPending: false,
          timestamp: 1_752_660_000,
          queuedAt: '2026-07-16T10:00:00.000Z',
        }));
      },
    };
    const persist = vi.spyOn(internals.chatRepository, 'saveMessage').mockResolvedValue();
    try {
      await expect(reticulumRuntime.sendChatMessage(destinationHash, '', '', [attachment]))
        .resolves.toEqual({ ok: true });
      expect(posted).toMatchObject({ type: 'sendLxmfMessage', destinationHash, attachments: [attachment] });
      expect(get(chatMessages)[0].attachments?.[0].data).toEqual(new Uint8Array([1, 2, 3]));
      expect(persist).toHaveBeenCalledOnce();
    } finally {
      internals.worker = originalWorker;
    }
  });

  it('keeps an unknown recipient in discovery until LXMF queueing replaces it', async () => {
    const destinationHash = '6'.repeat(32);
    const internals = reticulumRuntime as unknown as RuntimeInternals;
    const postMessage = vi.fn();
    internals.worker = { postMessage };
    const save = vi.spyOn(internals.chatRepository, 'saveMessage').mockResolvedValue();
    const replace = vi.spyOn(internals.chatRepository, 'replaceMessage').mockResolvedValue();

    const pending = reticulumRuntime.sendChatMessage(destinationHash, 'Find this recipient');
    const command = postMessage.mock.calls[0][0] as { requestId: string };
    await internals.handleEvent({
      type: 'chatMessageResolving',
      requestId: command.requestId,
      identityId: 'identity-1',
      messageId: '1'.repeat(64),
      sourceHash: 'a'.repeat(32),
      destinationHash,
      title: '',
      content: 'Find this recipient',
      method: 'direct',
      propagationFallback: false,
      queuedAt: '2026-08-13T10:00:00.000Z',
    });

    await expect(pending).resolves.toEqual({ ok: true });
    expect(get(chatMessages)).toEqual([expect.objectContaining({
      messageId: '1'.repeat(64),
      status: 'resolving',
    })]);
    expect(get(chatMessages)[0]).not.toHaveProperty('timestamp');
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ status: 'resolving' }));

    await internals.handleEvent({
      type: 'chatMessageQueued',
      requestId: command.requestId,
      identityId: 'identity-1',
      messageId: '2'.repeat(64),
      sourceHash: 'a'.repeat(32),
      destinationHash,
      title: '',
      content: 'Find this recipient',
      method: 'direct',
      propagationFallback: false,
      propagationFallbackPending: true,
      replacesMessageId: '1'.repeat(64),
      timestamp: 1_755_079_205,
      queuedAt: '2026-08-13T10:00:05.000Z',
    });

    expect(get(chatMessages)).toEqual([expect.objectContaining({
      messageId: '2'.repeat(64),
      status: 'queued',
      timestamp: 1_755_079_205,
    })]);
    expect(replace).toHaveBeenCalledWith(
      `identity-1:${'1'.repeat(64)}`,
      expect.objectContaining({ messageId: '2'.repeat(64), status: 'queued' }),
    );
  });

  it('fails unresolved recipients and starts discovery again when retried', async () => {
    const destinationHash = '7'.repeat(32);
    const resolvingMessageId = '3'.repeat(64);
    const internals = reticulumRuntime as unknown as RuntimeInternals;
    const postMessage = vi.fn();
    internals.worker = { postMessage };
    vi.spyOn(internals.chatRepository, 'saveMessage').mockResolvedValue();
    const replace = vi.spyOn(internals.chatRepository, 'replaceMessage').mockResolvedValue();

    await internals.handleEvent({
      type: 'chatMessageResolving',
      requestId: 'initial-request',
      identityId: 'identity-1',
      messageId: resolvingMessageId,
      sourceHash: 'a'.repeat(32),
      destinationHash,
      title: '',
      content: 'Retry discovery',
      method: 'direct',
      propagationFallback: false,
      queuedAt: '2026-08-13T10:00:00.000Z',
    });
    await internals.handleEvent({
      type: 'chatMessageState',
      identityId: 'identity-1',
      messageId: resolvingMessageId,
      state: 'failed',
    });
    expect(get(chatMessages)[0]).toMatchObject({ messageId: resolvingMessageId, status: 'failed' });

    const retry = reticulumRuntime.retryChatMessage(resolvingMessageId);
    const retryCommand = postMessage.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(retryCommand).toMatchObject({
      type: 'sendLxmfMessage',
      destinationHash,
      replacesMessageId: resolvingMessageId,
    });
    expect(retryCommand).not.toHaveProperty('timestamp');

    await internals.handleEvent({
      type: 'chatMessageResolving',
      requestId: retryCommand.requestId,
      identityId: 'identity-1',
      messageId: '4'.repeat(64),
      sourceHash: 'a'.repeat(32),
      destinationHash,
      title: '',
      content: 'Retry discovery',
      method: 'direct',
      propagationFallback: false,
      replacesMessageId: resolvingMessageId,
      queuedAt: '2026-08-13T10:00:20.000Z',
    });

    await expect(retry).resolves.toEqual({ ok: true });
    expect(get(chatMessages)).toEqual([expect.objectContaining({
      messageId: '4'.repeat(64),
      status: 'resolving',
    })]);
    expect(replace).toHaveBeenLastCalledWith(
      `identity-1:${resolvingMessageId}`,
      expect.objectContaining({ messageId: '4'.repeat(64), status: 'resolving' }),
    );
  });

  it('retries a failed attachment as a fresh delivery under the current method', async () => {
    const destinationHash = 'd'.repeat(32);
    const attachment = {
      kind: 'image' as const,
      name: 'photo.jpg',
      mimeType: 'image/jpeg',
      data: new Uint8Array([1, 2, 3]),
    };
    chatMessages.set([{
      id: 'identity-1:failed-opportunistic',
      identityId: 'identity-1',
      messageId: 'failed-opportunistic',
      sourceHash: 'a'.repeat(32),
      destinationHash,
      title: '',
      content: '',
      attachments: [attachment],
      method: 'opportunistic',
      representation: 'directResource',
      direction: 'outgoing',
      status: 'failed',
      timestamp: 1_752_660_000,
      receivedAt: '2026-07-16T10:00:00.000Z',
      ordering: {
        segment: 4,
        receivedSequence: 9,
        boundaryReason: 'outgoing',
      },
    }]);
    const internals = reticulumRuntime as unknown as RuntimeInternals;
    const postMessage = vi.fn();
    internals.worker = { postMessage };
    const replace = vi.spyOn(internals.chatRepository, 'replaceMessage').mockResolvedValue();

    const pending = reticulumRuntime.retryChatMessage('failed-opportunistic');
    const command = postMessage.mock.calls[0][0] as Record<string, unknown>;

    expect(command).toMatchObject({
      type: 'sendLxmfMessage',
      destinationHash,
      attachments: [attachment],
      replacesMessageId: 'failed-opportunistic',
      timestamp: 1_752_660_000,
    });

    await internals.handleEvent({
      type: 'chatMessageQueued',
      requestId: command.requestId,
      identityId: 'identity-1',
      messageId: 'fresh-direct-message',
      sourceHash: 'a'.repeat(32),
      destinationHash,
      title: '',
      content: '',
      attachments: [attachment],
      method: 'direct',
      propagationFallback: false,
      propagationFallbackPending: false,
      replacesMessageId: 'failed-opportunistic',
      timestamp: 1_752_660_100,
      queuedAt: '2026-07-16T10:01:40.000Z',
    });

    await expect(pending).resolves.toEqual({ ok: true });
    expect(replace).toHaveBeenCalledWith(
      'identity-1:failed-opportunistic',
      expect.objectContaining({
        messageId: 'fresh-direct-message',
        method: 'direct',
        status: 'queued',
        ordering: {
          segment: 4,
          receivedSequence: 9,
          boundaryReason: 'outgoing',
        },
      }),
    );
    expect(get(chatMessages)).toEqual([
      expect.objectContaining({ messageId: 'fresh-direct-message', method: 'direct' }),
    ]);
  });

  it('tracks and clears inbound LXMF resource progress', async () => {
    const internals = reticulumRuntime as unknown as RuntimeInternals;

    await internals.handleEvent({
      type: 'chatInboundTransfer',
      transferId: 'resource-1',
      destinationHash: 'a'.repeat(32),
      state: 'receiving',
      progress: 0.42,
      dataSize: 4096,
      transferSize: 4352,
    });
    expect(get(chatInboundTransfers)).toEqual([{
      id: 'resource-1',
      destinationHash: 'a'.repeat(32),
      progress: 0.42,
      dataSize: 4096,
      transferSize: 4352,
    }]);

    await internals.handleEvent({
      type: 'chatInboundTransfer',
      transferId: 'resource-1',
      state: 'completed',
      progress: 1,
      dataSize: 4096,
    });
    expect(get(chatInboundTransfers)).toEqual([]);
  });
});
