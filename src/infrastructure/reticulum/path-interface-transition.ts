import { interfaceNetworkFingerprint } from '../../domain/interface-announce';
import type { InterfaceConfig } from '../../domain/settings';

export interface RuntimeInterfaceBinding {
  interfaceId: string;
  runtimeIndex: number;
  networkFingerprint: string;
}

export interface PersistentPathTransitionResult {
  snapshot: Record<string, unknown>;
  retained: number;
  removed: number;
  remapped: number;
}

/**
 * Carries paths across a controlled runtime rebuild without treating
 * Leviculum's transient numeric interface indexes as stable identities.
 */
export function transitionPersistentPaths(
  snapshot: Record<string, unknown>,
  previousBindings: readonly RuntimeInterfaceBinding[],
  nextInterfaces: readonly InterfaceConfig[],
): PersistentPathTransitionResult {
  const paths = Array.isArray(snapshot.paths) ? snapshot.paths : [];
  const previousByRuntimeIndex = new Map(previousBindings.map((binding) => [
    binding.runtimeIndex,
    binding,
  ]));
  const nextByInterfaceId = new Map<string, {
    runtimeIndex: number;
    networkFingerprint: string;
  }>();
  let nextRuntimeIndex = 0;
  for (const config of nextInterfaces) {
    if (!config.enabled) continue;
    nextByInterfaceId.set(config.id, {
      runtimeIndex: nextRuntimeIndex,
      networkFingerprint: interfaceNetworkFingerprint(config),
    });
    nextRuntimeIndex += 1;
  }

  let removed = 0;
  let remapped = 0;
  const transitioned = paths.flatMap((value) => {
    if (!value || typeof value !== 'object') {
      removed += 1;
      return [];
    }
    const path = value as Record<string, unknown>;
    const previousRuntimeIndex = fieldRuntimeIndex(path);
    const previous = previousRuntimeIndex === undefined
      ? undefined
      : previousByRuntimeIndex.get(previousRuntimeIndex);
    const next = previous ? nextByInterfaceId.get(previous.interfaceId) : undefined;
    if (!previous || !next || next.networkFingerprint !== previous.networkFingerprint) {
      removed += 1;
      return [];
    }
    if (next.runtimeIndex === previousRuntimeIndex) return [path];
    remapped += 1;
    const remappedPath = { ...path };
    if ('interfaceIndex' in path || !('interface_index' in path)) {
      remappedPath.interfaceIndex = next.runtimeIndex;
    }
    if ('interface_index' in path) remappedPath.interface_index = next.runtimeIndex;
    return [remappedPath];
  });

  return {
    snapshot: {
      ...snapshot,
      paths: transitioned,
    },
    retained: transitioned.length,
    removed,
    remapped,
  };
}

function fieldRuntimeIndex(path: Record<string, unknown>): number | undefined {
  const value = path.interfaceIndex ?? path.interface_index;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === 'bigint' && value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER)) {
    return Number(value);
  }
  return undefined;
}
