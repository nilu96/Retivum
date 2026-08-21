import { describe, expect, it } from 'vitest';
import type { WebSocketInterfaceConfig } from '../../domain/settings';
import { interfaceNetworkFingerprint } from '../../domain/interface-announce';
import {
  createStableNetworkCheckpoint,
  restoreStableNetworkCheckpoint,
} from './network-path-checkpoint';

function configuredInterface(
  id: string,
  enabled = true,
  host = `${id}.example`,
): WebSocketInterfaceConfig {
  return {
    id,
    schemaVersion: 5,
    createdAt: `2026-08-21T12:00:0${id.length}.000Z`,
    type: 'websocket',
    name: id,
    enabled,
    mode: 'full',
    reannounceOnReconnect: true,
    ifac: { networkName: '', passphrase: '', credentialRevision: 'test' },
    connection: { scheme: 'wss', host, path: '/' },
  };
}

function path(destination: number, interfaceIndex: number): Record<string, unknown> {
  return {
    destinationHash: Uint8Array.from({ length: 16 }, () => destination),
    hops: 2,
    expiresMs: 10_000,
    interfaceIndex,
    randomBlobs: [],
  };
}

describe('stable network path checkpoints', () => {
  it('restores surviving paths by stable interface ID after indexes shift', () => {
    const first = configuredInterface('first');
    const second = configuredInterface('second');
    const third = configuredInterface('third');
    const checkpoint = createStableNetworkCheckpoint(
      { version: 1, paths: [path(1, 0), path(2, 1)] },
      [first, second].map((config, runtimeIndex) => ({
        interfaceId: config.id,
        runtimeIndex,
        networkFingerprint: interfaceNetworkFingerprint(config),
      })),
    );

    expect(checkpoint.networkState.paths).toEqual([]);
    expect(checkpoint.paths.every((entry) => (
      !('interfaceIndex' in entry.path) && !('interface_index' in entry.path)
    ))).toBe(true);

    const restored = restoreStableNetworkCheckpoint(
      checkpoint,
      [{ ...first, enabled: false }, second, third],
    );
    expect(restored.snapshot.paths).toEqual([
      expect.objectContaining({
        destinationHash: expect.any(Uint8Array),
        interfaceIndex: 0,
      }),
    ]);
    expect(restored).toMatchObject({ discarded: 1, needsPersistence: true });
  });

  it('drops paths when the material interface configuration changed', () => {
    const original = configuredInterface('relay', true, 'old.example');
    const checkpoint = createStableNetworkCheckpoint(
      { paths: [path(1, 0)] },
      [{
        interfaceId: original.id,
        runtimeIndex: 0,
        networkFingerprint: interfaceNetworkFingerprint(original),
      }],
    );

    const restored = restoreStableNetworkCheckpoint(
      checkpoint,
      [configuredInterface('relay', true, 'new.example')],
    );
    expect(restored.snapshot.paths).toEqual([]);
    expect(restored.discarded).toBe(1);
  });

  it('discards numeric-only legacy paths while preserving other network state', () => {
    const restored = restoreStableNetworkCheckpoint({
      version: 1,
      knownIdentities: [{ destinationHash: [1], publicKey: [2] }],
      paths: [path(1, 0), path(2, 9)],
    }, [configuredInterface('first')]);

    expect(restored.snapshot).toEqual({
      version: 1,
      knownIdentities: [{ destinationHash: [1], publicKey: [2] }],
      paths: [],
    });
    expect(restored).toMatchObject({ discarded: 2, needsPersistence: true });
  });

  it('does not persist a path whose live runtime index has no binding', () => {
    const checkpoint = createStableNetworkCheckpoint(
      { version: 1, paths: [path(1, 7)] },
      [],
    );
    expect(checkpoint.paths).toEqual([]);
  });

  it('rejects a malformed stable checkpoint instead of treating it as legacy state', () => {
    expect(() => restoreStableNetworkCheckpoint({
      retivumNetworkCheckpointVersion: 1,
      networkState: {},
      paths: [{ interfaceId: 'first' }],
    }, [configuredInterface('first')])).toThrow('RUNTIME_NETWORK_CHECKPOINT_INVALID');
  });
});
