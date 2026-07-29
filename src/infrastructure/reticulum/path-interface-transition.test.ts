import { describe, expect, it } from 'vitest';
import type { WebSocketInterfaceConfig } from '../../domain/settings';
import {
  transitionPersistentPaths,
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
    schemaVersion: 3,
    type: 'websocket',
    name: id,
    enabled,
    mode: 'full',
    reannounceOnReconnect: true,
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

describe('transitionPersistentPaths', () => {
  it('retains paths whose stable interface and runtime index are unchanged', () => {
    const first = configuredInterface('first');
    const second = configuredInterface('second');
    const firstPath = path(1, 0);
    const secondPath = path(2, 1);

    const result = transitionPersistentPaths(
      { version: 1, paths: [firstPath, secondPath] },
      [binding(first, 0), binding(second, 1)],
      [first, second],
    );

    expect(result).toEqual({
      snapshot: { version: 1, paths: [firstPath, secondPath] },
      retained: 2,
      removed: 0,
      remapped: 0,
    });
  });

  it('deletes disabled-interface paths and remaps every following interface', () => {
    const first = configuredInterface('first');
    const second = configuredInterface('second');
    const third = configuredInterface('third');

    const result = transitionPersistentPaths(
      { paths: [path(1, 0), path(2, 1), path(3, 2)] },
      [binding(first, 0), binding(second, 1), binding(third, 2)],
      [{ ...first, enabled: false }, second, third],
    );

    expect(result.snapshot.paths).toEqual([
      expect.objectContaining({ destinationHash: expect.any(Uint8Array), interfaceIndex: 0 }),
      expect.objectContaining({ destinationHash: expect.any(Uint8Array), interfaceIndex: 1 }),
    ]);
    expect(result).toMatchObject({ retained: 2, removed: 1, remapped: 2 });
  });

  it('deletes removed-interface paths while retaining and remapping the others', () => {
    const first = configuredInterface('first');
    const second = configuredInterface('second');
    const third = configuredInterface('third');

    const result = transitionPersistentPaths(
      { paths: [path(1, 0), path(2, 1), path(3, 2)] },
      [binding(first, 0), binding(second, 1), binding(third, 2)],
      [first, third],
    );

    expect(result.snapshot.paths).toEqual([
      expect.objectContaining({ interfaceIndex: 0 }),
      expect.objectContaining({ interfaceIndex: 1 }),
    ]);
    expect(result).toMatchObject({ retained: 2, removed: 1, remapped: 1 });
  });

  it('deletes a path when the same stable interface now identifies another network', () => {
    const current = configuredInterface('relay', true, 'old.example');
    const changed = configuredInterface('relay', true, 'new.example');

    expect(transitionPersistentPaths(
      { paths: [path(1, 0)] },
      [binding(current, 0)],
      [changed],
    )).toMatchObject({
      snapshot: { paths: [] },
      retained: 0,
      removed: 1,
      remapped: 0,
    });
  });

  it('supports legacy snake-case indexes and removes paths without an old binding', () => {
    const retained = configuredInterface('retained');
    const result = transitionPersistentPaths(
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
      [binding(retained, 3)],
      [retained],
    );

    expect(result.snapshot.paths).toEqual([
      expect.objectContaining({ interface_index: 0 }),
    ]);
    expect(result).toMatchObject({ retained: 1, removed: 1, remapped: 1 });
  });
});
