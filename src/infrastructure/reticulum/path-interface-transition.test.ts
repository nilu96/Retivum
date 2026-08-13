import { describe, expect, it } from 'vitest';
import type { WebSocketInterfaceConfig } from '../../domain/settings';
import {
  planRuntimeInterfaceTransition,
  remapPersistentPaths,
  type RuntimeInterfaceBinding,
} from './path-interface-transition';
import { interfaceNetworkFingerprint } from '../../domain/interface-announce';

function configuredInterface(
  id: string,
  enabled = true,
  host = `${id}.example`,
): WebSocketInterfaceConfig {
  return {
    id,
    schemaVersion: 5,
    createdAt: '2026-07-29T12:00:00.000Z',
    type: 'websocket',
    name: id,
    enabled,
    mode: 'full',
    reannounceOnReconnect: true,
    ifac: { networkName: '', passphrase: '', credentialRevision: 'test' },
    connection: { scheme: 'wss', host, path: '/' },
  };
}

function binding(config: WebSocketInterfaceConfig, runtimeIndex: number): RuntimeInterfaceBinding {
  return {
    interfaceId: config.id,
    runtimeIndex,
    networkFingerprint: interfaceNetworkFingerprint(config),
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

describe('runtime interface path transitions', () => {
  it('retains paths whose stable interface and runtime index are unchanged', () => {
    const first = configuredInterface('first');
    const second = configuredInterface('second');
    const firstPath = path(1, 0);
    const secondPath = path(2, 1);
    const plan = planRuntimeInterfaceTransition(
      [binding(first, 0), binding(second, 1)],
      [first, second],
    );

    expect(plan).toEqual({
      unavailableRuntimeIndexes: [],
      retainedInterfaces: [{
        interfaceId: first.id,
        previousRuntimeIndex: 0,
        nextRuntimeIndex: 0,
      }, {
        interfaceId: second.id,
        previousRuntimeIndex: 1,
        nextRuntimeIndex: 1,
      }],
    });
    expect(remapPersistentPaths(
      { version: 1, paths: [firstPath, secondPath] },
      plan,
    )).toEqual({
      snapshot: { version: 1, paths: [firstPath, secondPath] },
      retained: 2,
      discarded: 0,
      remapped: 0,
    });
  });

  it('reports a disabled interface to Leviculum and remaps every survivor after it', () => {
    const first = configuredInterface('first');
    const second = configuredInterface('second');
    const third = configuredInterface('third');
    const plan = planRuntimeInterfaceTransition(
      [binding(first, 0), binding(second, 1), binding(third, 2)],
      [{ ...first, enabled: false }, second, third],
    );

    expect(plan).toEqual({
      unavailableRuntimeIndexes: [0],
      retainedInterfaces: [{
        interfaceId: second.id,
        previousRuntimeIndex: 1,
        nextRuntimeIndex: 0,
      }, {
        interfaceId: third.id,
        previousRuntimeIndex: 2,
        nextRuntimeIndex: 1,
      }],
    });
    const result = remapPersistentPaths(
      // Leviculum removed the first interface's path before this snapshot.
      { paths: [path(2, 1), path(3, 2)] },
      plan,
    );

    expect(result.snapshot.paths).toEqual([
      expect.objectContaining({ destinationHash: expect.any(Uint8Array), interfaceIndex: 0 }),
      expect.objectContaining({ destinationHash: expect.any(Uint8Array), interfaceIndex: 1 }),
    ]);
    expect(result).toMatchObject({ retained: 2, discarded: 0, remapped: 2 });
  });

  it('reports a removed interface to Leviculum while retaining the others', () => {
    const first = configuredInterface('first');
    const second = configuredInterface('second');
    const third = configuredInterface('third');
    const plan = planRuntimeInterfaceTransition(
      [binding(first, 0), binding(second, 1), binding(third, 2)],
      [first, third],
    );

    expect(plan).toEqual({
      unavailableRuntimeIndexes: [1],
      retainedInterfaces: [{
        interfaceId: first.id,
        previousRuntimeIndex: 0,
        nextRuntimeIndex: 0,
      }, {
        interfaceId: third.id,
        previousRuntimeIndex: 2,
        nextRuntimeIndex: 1,
      }],
    });
  });

  it('reports a materially changed stable interface as unavailable', () => {
    const current = configuredInterface('relay', true, 'old.example');
    const changed = configuredInterface('relay', true, 'new.example');

    expect(planRuntimeInterfaceTransition(
      [binding(current, 0)],
      [changed],
    )).toEqual({
      unavailableRuntimeIndexes: [0],
      retainedInterfaces: [],
    });
  });

  it('remaps legacy snake-case indexes and defensively discards unmapped paths', () => {
    const retained = configuredInterface('retained');
    const plan = planRuntimeInterfaceTransition(
      [binding(retained, 3)],
      [retained],
    );
    const result = remapPersistentPaths(
      {
        paths: [
          {
            destination_hash: Array(16).fill(1),
            hops: 2,
            expires_ms: 10_000,
            interface_index: 3,
            random_blobs: [],
          },
          path(2, 9),
        ],
      },
      plan,
    );

    expect(result.snapshot.paths).toEqual([
      expect.objectContaining({ interface_index: 0 }),
    ]);
    expect(result).toMatchObject({ retained: 1, discarded: 1, remapped: 1 });
  });
});
