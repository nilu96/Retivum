import { interfaceNetworkFingerprint } from '../../domain/interface-announce';
import type { InterfaceConfig } from '../../domain/settings';

export interface RuntimeInterfaceBinding {
  interfaceId: string;
  runtimeIndex: number;
  networkFingerprint: string;
}

export interface RetainedRuntimeInterfaceBinding {
  interfaceId: string;
  previousRuntimeIndex: number;
  nextRuntimeIndex: number;
}

export interface RuntimeInterfaceTransitionPlan {
  unavailableRuntimeIndexes: number[];
  retainedInterfaces: RetainedRuntimeInterfaceBinding[];
}

export interface PersistentPathRemapResult {
  snapshot: Record<string, unknown>;
  retained: number;
  discarded: number;
  remapped: number;
}

/**
 * Determines which old runtime interfaces Retivum must report as down to
 * Leviculum, and how surviving interfaces will be indexed by the new runtime.
 */
export function planRuntimeInterfaceTransition(
  previousBindings: readonly RuntimeInterfaceBinding[],
  nextInterfaces: readonly InterfaceConfig[],
): RuntimeInterfaceTransitionPlan {
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

  const unavailableRuntimeIndexes: number[] = [];
  const retainedInterfaces: RetainedRuntimeInterfaceBinding[] = [];
  for (const previous of previousBindings) {
    const next = nextByInterfaceId.get(previous.interfaceId);
    if (!next || next.networkFingerprint !== previous.networkFingerprint) {
      unavailableRuntimeIndexes.push(previous.runtimeIndex);
      continue;
    }
    retainedInterfaces.push({
      interfaceId: previous.interfaceId,
      previousRuntimeIndex: previous.runtimeIndex,
      nextRuntimeIndex: next.runtimeIndex,
    });
  }
  return {
    unavailableRuntimeIndexes: unavailableRuntimeIndexes.sort((left, right) => left - right),
    retainedInterfaces,
  };
}

/**
 * Rewrites paths that survived Leviculum's interface-down processing to the
 * new runtime indexes. Unmapped entries are discarded only as a defensive
 * boundary check; normal stale-path deletion belongs to Leviculum.
 */
export function remapPersistentPaths(
  snapshot: Record<string, unknown>,
  plan: RuntimeInterfaceTransitionPlan,
): PersistentPathRemapResult {
  const paths = Array.isArray(snapshot.paths) ? snapshot.paths : [];
  const retainedByPreviousRuntimeIndex = new Map(plan.retainedInterfaces.map((binding) => [
    binding.previousRuntimeIndex,
    binding,
  ]));

  let discarded = 0;
  let remapped = 0;
  const transitioned = paths.flatMap((value) => {
    if (!value || typeof value !== 'object') {
      discarded += 1;
      return [];
    }
    const path = value as Record<string, unknown>;
    const previousRuntimeIndex = fieldRuntimeIndex(path);
    const retained = previousRuntimeIndex === undefined
      ? undefined
      : retainedByPreviousRuntimeIndex.get(previousRuntimeIndex);
    if (!retained) {
      discarded += 1;
      return [];
    }
    if (retained.nextRuntimeIndex === previousRuntimeIndex) return [path];
    remapped += 1;
    const remappedPath = { ...path };
    if ('interfaceIndex' in path || !('interface_index' in path)) {
      remappedPath.interfaceIndex = retained.nextRuntimeIndex;
    }
    if ('interface_index' in path) remappedPath.interface_index = retained.nextRuntimeIndex;
    return [remappedPath];
  });

  return {
    snapshot: {
      ...snapshot,
      paths: transitioned,
    },
    retained: transitioned.length,
    discarded,
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
